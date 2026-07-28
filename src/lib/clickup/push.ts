import "server-only";
import type { ClickUpVinculo } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toAmountString, ZERO } from "@/lib/money";
import { hasClickUpToken } from "@/lib/env";
import { getListFields, setTaskFieldValue, ClickUpApiError } from "@/lib/clickup/client";
import { devePush } from "@/lib/clickup/decisao-push";
import { periodoCorrente } from "@/lib/clickup/periodo-corrente";
import { composicaoDoVinculo } from "@/lib/clickup/composicao";

/**
 * Alimenta os campos de mês do ClickUp a partir de RevenueCategorizedLine
 * (ver ADR-0023). O ClickUp é só um espelho — nunca fonte de verdade — então
 * NADA aqui pode propagar exceção para quem chama: cada vínculo é isolado no
 * seu próprio try/catch, e mesmo assim `pushValoresDoMesCorrente` (chamada
 * dentro de startCategorizationRun) é sempre embrulhada de novo por quem a
 * invoca. Toda tentativa (sucesso ou falha) fica em ClickUpPushLog — nunca
 * falha em silêncio (financial-rigor.md #8).
 */

export interface ResultadoPush {
  sucesso: boolean;
  valorEnviado: string;
  pulado?: boolean;
  erro?: string;
}

// Se o mês genuinamente não tem campo currency correspondente na lista (ex.:
// campo renomeado/apagado, ou tipo trocado por engano no ClickUp), não faz
// sentido bater na API a cada push — isso multiplicaria chamadas de rede por
// vínculo/ciclo de sincronização, achado de revisão adversarial 2026-07-27.
// Só tenta atualizar de novo depois desse intervalo.
const CACHE_MAX_AGE_MS = 60 * 60_000;

async function atualizarCacheDeCampos(listId: string): Promise<Record<number, string>> {
  const camposPorMes = await getListFields(listId);
  await prisma.clickUpListaCache.upsert({
    where: { clickUpListId: listId },
    update: { camposPorMes },
    create: { clickUpListId: listId, camposPorMes },
  });
  return camposPorMes;
}

/**
 * Resolve o fieldId do mês corrente. Atualiza o cache automaticamente quando
 * não existe ainda, ou quando o mês procurado falta E o cache já está velho
 * (CACHE_MAX_AGE_MS) — evita tanto servir um cache eternamente incompleto
 * quanto martelar a rede a cada push enquanto o mês genuinamente não existe
 * na lista.
 */
async function resolverFieldIdDoMes(listId: string, mes: number): Promise<string> {
  const cache = await prisma.clickUpListaCache.findUnique({ where: { clickUpListId: listId } });
  let campos = (cache?.camposPorMes as Record<number, string> | undefined) ?? {};
  const cacheVelho = !cache || Date.now() - cache.atualizadoEm.getTime() > CACHE_MAX_AGE_MS;
  if (!cache || (!campos[mes] && cacheVelho)) {
    campos = await atualizarCacheDeCampos(listId);
  }
  const fieldId = campos[mes];
  if (!fieldId) {
    throw new ClickUpApiError(`Campo do mês ${mes} não encontrado nos campos "currency" da lista ${listId}.`);
  }
  return fieldId;
}

/**
 * Escreve o valor no campo, com UMA tentativa de auto-cura: se a escrita
 * falhar (campo renomeado/apagado no ClickUp depois do cache foi gravado, ou
 * qualquer outro erro da API nesta chamada específica), atualiza o cache da
 * lista e tenta de novo com o fieldId fresco, ANTES de desistir — é o
 * mecanismo real por trás do que o comentário de ClickUpListaCache promete
 * (nunca existiu um botão manual de refresh na UI; isto substitui a promessa
 * por um comportamento automático, achado de revisão adversarial 2026-07-27).
 */
async function escreverComAutoCura(vinculo: ClickUpVinculo, fieldId: string, mes: number, valor: number): Promise<void> {
  try {
    await setTaskFieldValue(vinculo.clickUpTaskId, fieldId, valor);
  } catch (err) {
    const camposFrescos = await atualizarCacheDeCampos(vinculo.clickUpListId);
    const fieldIdFresco = camposFrescos[mes];
    if (!fieldIdFresco || fieldIdFresco === fieldId) throw err;
    await setTaskFieldValue(vinculo.clickUpTaskId, fieldIdFresco, valor);
  }
}

async function pushUmVinculo(
  vinculo: ClickUpVinculo,
  outrosAtivosDaMesmaCategoria: ClickUpVinculo[],
  ano: number,
  mes: number,
  fromDate: Date,
  toDateExclusive: Date,
  forcar: boolean,
): Promise<ResultadoPush> {
  let total = ZERO;
  try {
    // A composição (quais linhas somam) vem de `composicao.ts` — a MESMA função
    // que a tela admin usa pra listar essas faturas. Reimplementar o filtro aqui
    // faria a tela e o push divergirem sem ninguém perceber; ver o doc daquele
    // módulo para os 4 filtros que definem a composição.
    ({ total } = await composicaoDoVinculo(vinculo, outrosAtivosDaMesmaCategoria, fromDate, toDateExclusive));

    if (!forcar) {
      const ultimoSucesso = await prisma.clickUpPushLog.findFirst({
        where: { vinculoId: vinculo.id, ano, mes, sucesso: true },
        orderBy: { enviadoEm: "desc" },
      });
      if (!devePush(ultimoSucesso?.valorEnviado.toString() ?? null, total)) {
        return { sucesso: true, valorEnviado: toAmountString(total), pulado: true };
      }
    }

    const fieldId = await resolverFieldIdDoMes(vinculo.clickUpListId, mes);
    await escreverComAutoCura(vinculo, fieldId, mes, total.toNumber());
    await prisma.clickUpPushLog.create({
      data: { vinculoId: vinculo.id, ano, mes, valorEnviado: toAmountString(total), sucesso: true },
    });
    return { sucesso: true, valorEnviado: toAmountString(total) };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error(`[clickup] push falhou (vínculo ${vinculo.id}, categoria "${vinculo.categoria}"): ${mensagem}`);
    await prisma.clickUpPushLog
      .create({
        data: { vinculoId: vinculo.id, ano, mes, valorEnviado: toAmountString(total), sucesso: false, erro: mensagem.slice(0, 2000) },
      })
      .catch(() => {
        /* nunca deixar uma falha ao GRAVAR o log esconder o erro original */
      });
    return { sucesso: false, valorEnviado: toAmountString(total), erro: mensagem };
  }
}

export interface ResumoPushDoMesCorrente {
  vinculosAtivos: number;
  atualizados: number;
  semMudanca: number;
  falharam: number;
}

/**
 * Empurra o total do MÊS CORRENTE de cada vínculo ativo — chamada a cada
 * sincronização (run.ts), não só no fechamento do mês (pedido explícito do
 * usuário). Sequencial de propósito: mantém a taxa de chamadas longe do
 * limite de 100/min do ClickUp sem precisar de um limitador à parte.
 *
 * Devolve um resumo (não só void) pra quem chama poder logar o que aconteceu
 * — sem isso, confirmar que o push automático de fato roda a cada ciclo
 * exigiria acesso direto ao banco; com o resumo, um log de servidor (visível
 * no Easypanel, por exemplo) já basta (pedido do usuário: "verifique e
 * assegure" que o push acontece em toda sincronização, 2026-07-27).
 */
export async function pushValoresDoMesCorrente(): Promise<ResumoPushDoMesCorrente> {
  const vazio: ResumoPushDoMesCorrente = { vinculosAtivos: 0, atualizados: 0, semMudanca: 0, falharam: 0 };
  if (!hasClickUpToken()) return vazio;
  const vinculos = await prisma.clickUpVinculo.findMany({ where: { ativo: true } });
  if (vinculos.length === 0) return vazio;

  const resumo: ResumoPushDoMesCorrente = { vinculosAtivos: vinculos.length, atualizados: 0, semMudanca: 0, falharam: 0 };
  const { ano, mes, fromDate, toDateExclusive } = periodoCorrente();
  for (const vinculo of vinculos) {
    const outrosDaMesmaCategoria = vinculos.filter((v) => v.id !== vinculo.id && v.categoria === vinculo.categoria);
    const resultado = await pushUmVinculo(vinculo, outrosDaMesmaCategoria, ano, mes, fromDate, toDateExclusive, false);
    if (!resultado.sucesso) resumo.falharam += 1;
    else if (resultado.pulado) resumo.semMudanca += 1;
    else resumo.atualizados += 1;
  }
  return resumo;
}

/** "Empurrar agora" da tela admin — ignora a checagem de "valor mudou?" para servir de teste. */
export async function pushVinculoAgora(vinculoId: string): Promise<ResultadoPush> {
  if (!hasClickUpToken()) return { sucesso: false, valorEnviado: "0", erro: "CLICKUP_API_TOKEN não configurado." };
  const vinculo = await prisma.clickUpVinculo.findUnique({ where: { id: vinculoId } });
  if (!vinculo) return { sucesso: false, valorEnviado: "0", erro: "Vínculo não encontrado." };

  // Mesma exclusão de linhas que a rodada automática — sem isso, testar UM
  // vínculo isoladamente mostraria um valor inflado sempre que ele dividisse
  // faturas combinadas com outro vínculo ativo da mesma categoria.
  const outrosDaMesmaCategoria = await prisma.clickUpVinculo.findMany({
    where: { categoria: vinculo.categoria, ativo: true, id: { not: vinculo.id } },
  });

  const { ano, mes, fromDate, toDateExclusive } = periodoCorrente();
  return pushUmVinculo(vinculo, outrosDaMesmaCategoria, ano, mes, fromDate, toDateExclusive, true);
}
