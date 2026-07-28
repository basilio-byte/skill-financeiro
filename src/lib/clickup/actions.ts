"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRole } from "@/lib/auth/session";
import { formatBRL, money, roundMoney, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import { pushVinculoAgora } from "@/lib/clickup/push";
import { normalizarPadroes, bateAlgumPadrao, acharSobreposicoes, type Sobreposicao } from "@/lib/clickup/filtro-padroes";
import { periodoCorrente, limitesDoMes } from "@/lib/clickup/periodo-corrente";
import { composicaoDoVinculo, type LinhaDaComposicao, type LinhaExcluidaDaComposicao } from "@/lib/clickup/composicao";

const CLICKUP_ADMIN_PATH = "/integracoes/clickup";

/**
 * Aceita tanto o ID cru quanto uma URL colada do ClickUp — pega sempre o
 * último segmento do caminho, que é onde o ClickUp coloca o ID (de tarefa
 * ou de lista) em qualquer formato de link que ele gera.
 */
function extrairIdDoTexto(valor: string): string {
  const limpo = valor.trim();
  if (!limpo) return "";
  try {
    const url = new URL(limpo);
    const segmentos = url.pathname.split("/").filter(Boolean);
    return segmentos[segmentos.length - 1] || limpo;
  } catch {
    return limpo;
  }
}

// IDs reais do ClickUp nunca têm "/" nem "." — exigir isso aqui (antes de
// persistir) rejeita de cara um valor colado errado, em vez de deixar o
// path traversal só ser barrado depois, no client HTTP (defesa em camadas —
// achado de revisão adversarial 2026-07-27).
const ID_CLICKUP_RE = /^[a-zA-Z0-9_-]+$/;

// -----------------------------------------------------------------------
// Prévia: mostra ANTES de salvar quais linhas reais (servicoOuPlano + soma)
// um padrão vai casar — nunca vincula por nome parecido às cegas (é
// dinheiro). Achado real (2026-07-27): cada tarefa do ClickUp representa um
// PRODUTO (ex. "Endereço Fiscal Batial"), somando todos os clientes que
// usam aquele produto, não um cliente só — ver comentário do model
// ClickUpVinculo em schema.prisma.
// -----------------------------------------------------------------------

export interface PreviewItem {
  servicoOuPlano: string;
  ocorrencias: number;
  totalHistorico: string;
  clientesDistintos: number;
}

export interface PreviewState {
  error?: string;
  itens?: PreviewItem[];
  totalMesCorrente?: string;
  sobreposicoes?: Sobreposicao[];
}

export async function previsualizarVinculoAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const categoria = String(formData.get("categoria") ?? "").trim();
  const padroes = normalizarPadroes(String(formData.get("padroes") ?? ""));
  if (!categoria) return { error: "Informe a categoria." };
  if (padroes.length === 0) return { error: "Informe ao menos um padrão (um por linha)." };

  // Busca só por categoria — o casamento por padrão é feito em JS logo
  // abaixo (bateAlgumPadrao), não numa query `contains` do Postgres, porque
  // precisa ignorar acento (ex. "Comércio"/"Comercio" convivem no
  // `servicoOuPlano` real da Conexa) e o Postgres só ignora maiúscula/
  // minúscula por padrão.
  const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
    where: { categoria },
    select: { servicoOuPlano: true, valorRecebidoCat: true, clienteConexaId: true, dataCredito: true },
  });
  const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, padroes));

  const grupos = new Map<string, { total: Money; ocorrencias: number; clientes: Set<number | null> }>();
  for (const l of linhasQueBatem) {
    const g = grupos.get(l.servicoOuPlano) ?? { total: ZERO, ocorrencias: 0, clientes: new Set<number | null>() };
    g.total = g.total.plus(money(l.valorRecebidoCat));
    g.ocorrencias += 1;
    g.clientes.add(l.clienteConexaId);
    grupos.set(l.servicoOuPlano, g);
  }
  const itens: PreviewItem[] = [...grupos.entries()]
    .map(([servicoOuPlano, g]) => ({
      servicoOuPlano,
      ocorrencias: g.ocorrencias,
      totalHistorico: toAmountString(roundMoney(g.total)),
      clientesDistintos: g.clientes.size,
    }))
    .sort((a, b) => Number(b.totalHistorico) - Number(a.totalHistorico));

  const { fromDate, toDateExclusive } = periodoCorrente();

  // Sobreposição: alguma dessas linhas TAMBÉM bate num vínculo já ativo da
  // mesma categoria? Achado real (Salas Privativas): uma fatura pode combinar
  // várias salas na mesma linha de servicoOuPlano com um valor único pras
  // várias juntas — se dois vínculos (um por sala) casarem essa MESMA linha,
  // os dois somam o valor inteiro, dobrando ou triplicando dinheiro que não
  // existe. Nunca detectável olhando só o padrão novo isolado.
  const outrosVinculos = await prisma.clickUpVinculo.findMany({
    where: { categoria, ativo: true },
    select: { id: true, clickUpTaskId: true, padroes: true },
  });
  const sobreposicoes = acharSobreposicoes(
    linhasQueBatem,
    outrosVinculos.map((v) => ({ id: v.id, clickUpTaskId: v.clickUpTaskId, padroes: v.padroes as string[] })),
  );

  // "Quanto isso empurraria agora" sai da MESMA função que o push usa — nunca
  // de uma soma de linha inteira feita à parte. Desde a ADR-0028 o push divide
  // fatura combinada por item; uma prévia que somasse a linha cheia prometeria
  // ao admin um valor maior do que ele de fato receberia (achado da revisão
  // adversarial 2026-07-28). O vínculo hipotético entra com `criadoEm: agora`
  // — é como ele nasceria, o mais NOVO da categoria, perdendo todo desempate
  // para os existentes: a prévia mostra o caso realista, nunca o otimista.
  const ativosDaCategoria = await prisma.clickUpVinculo.findMany({ where: { categoria, ativo: true } });
  const hipotetico = {
    id: "",
    categoria,
    padroes,
    clickUpListId: "",
    clickUpTaskId: "",
    ativo: true,
    criadoPorId: null,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  } as unknown as Parameters<typeof composicaoDoVinculo>[0];
  const previa = await composicaoDoVinculo(hipotetico, ativosDaCategoria, fromDate, toDateExclusive);

  return { itens, totalMesCorrente: toAmountString(previa.total), sobreposicoes };
}

const vinculoSchema = z.object({
  categoria: z.string().trim().min(1, "Informe a categoria"),
  padroes: z
    .string()
    .transform((v) => normalizarPadroes(v))
    .refine((arr) => arr.length > 0, "Informe ao menos um padrão (um por linha)"),
  clickUpListId: z.string().trim().regex(ID_CLICKUP_RE, "ID da lista do ClickUp inválido — cole só o ID, sem barras ou pontos"),
  clickUpTaskId: z.string().trim().regex(ID_CLICKUP_RE, "ID da tarefa do ClickUp inválido — cole só o ID, sem barras ou pontos"),
});

export interface VinculoFormState {
  error?: string;
  ok?: string;
  aviso?: string;
}

/**
 * Cadastra o vínculo categoria + padrões (contra `servicoOuPlano`) -> tarefa
 * do ClickUp. A tela já mostrou a prévia real antes deste submit — aqui só
 * confirma de novo que existe histórico (defesa extra pra quem pular a
 * prévia), nunca por nome parecido inferido às cegas.
 */
export async function criarVinculoAction(_prev: VinculoFormState, formData: FormData): Promise<VinculoFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const parsed = vinculoSchema.safeParse({
    categoria: formData.get("categoria"),
    padroes: formData.get("padroes"),
    clickUpListId: extrairIdDoTexto(String(formData.get("clickUpListId") ?? "")),
    clickUpTaskId: extrairIdDoTexto(String(formData.get("clickUpTaskId") ?? "")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  // Padrão com ";" casaria o texto CONCATENADO de uma linha combinada, mas
  // nunca um item individual — e desde a ADR-0028 o push casa item a item.
  // Resultado silencioso: o vínculo empurraria R$ 0,00 pra sempre e a linha
  // nem apareceria no detalhamento. Bloqueia porque é sempre um engano (o ";"
  // é separador que o motor inventa ao juntar itens, não faz parte do nome de
  // nenhum produto). Achado da revisão adversarial 2026-07-28.
  const comSeparador = parsed.data.padroes.filter((p) => p.includes(";"));
  if (comSeparador.length > 0) {
    return {
      error:
        `Padrão com ";" não casa nada: ${comSeparador.map((p) => `"${p}"`).join(", ")}. ` +
        `O ";" só existe porque o sistema junta vários produtos de uma fatura numa linha só — ` +
        `use o nome de UM produto (ex.: "[SEAWAY] - Cabine"), que a divisão por item cuida do resto.`,
    };
  }

  // Nenhuma linha bate com categoria+padrões — pode ser um padrão digitado
  // errado; não bloqueia (pode passar a bater no futuro), mas avisa, senão o
  // vínculo empurraria R$ 0,00 todo mês, indistinguível de um mês real sem
  // receita (achado de revisão adversarial 2026-07-27).
  const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
    where: { categoria: parsed.data.categoria },
    select: { servicoOuPlano: true },
  });
  const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, parsed.data.padroes));
  const temHistorico = linhasQueBatem.length > 0;

  // Avisa (não bloqueia mais) se este padrão bater numa linha que outro
  // vínculo ativo da mesma categoria também reivindica — faturas combinando
  // várias salas/produtos numa linha só (achado real, Salas Privativas).
  // Até 2026-07-28 isso BLOQUEAVA a criação inteira, porque só existia
  // proteção na criação (comparava contra o histórico daquele momento, nunca
  // contra o push recorrente) — descartava vínculos inteiros mesmo quando a
  // maior parte da receita da sala era limpa (achado real, Serviços de
  // Espaço - Seaway Center: só 4 de ~13 salas específicas chegaram a ser
  // criadas). Agora que `linhasExclusivasDoVinculo` (push.ts) exclui essas
  // linhas em TODO push — não só na criação —, o vínculo mais novo nunca
  // dobra o valor da linha combinada; só deixa de contar as linhas que já
  // pertencem ao vínculo mais antigo, contando normalmente as linhas
  // exclusivas dele. Criar continua sendo a decisão certa; só o aviso muda de
  // "bloqueio" pra "informativo".
  const outrosVinculos = await prisma.clickUpVinculo.findMany({
    where: { categoria: parsed.data.categoria, ativo: true },
    select: { id: true, clickUpTaskId: true, padroes: true },
  });
  const sobreposicoes = acharSobreposicoes(
    linhasQueBatem,
    outrosVinculos.map((v) => ({ id: v.id, clickUpTaskId: v.clickUpTaskId, padroes: v.padroes as string[] })),
  );

  try {
    await prisma.clickUpVinculo.create({
      data: {
        categoria: parsed.data.categoria,
        padroes: parsed.data.padroes,
        clickUpListId: parsed.data.clickUpListId,
        clickUpTaskId: parsed.data.clickUpTaskId,
        criadoPorId: auth.user.id,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "Esta tarefa do ClickUp já está ligada a outro vínculo." };
    }
    throw err;
  }

  let aviso: string | undefined;
  if (!temHistorico) {
    aviso = `Nenhuma fatura já categorizada bate com "${parsed.data.categoria}" + os padrões informados — confira a grafia, senão este vínculo vai empurrar R$ 0,00 todo mês.`;
  } else if (sobreposicoes.length > 0) {
    const exemplos = sobreposicoes
      .slice(0, 3)
      .map((s) => `"${s.servicoOuPlano}" (tarefa ${s.clickUpTaskId})`)
      .join("; ");
    aviso = `${sobreposicoes.length} linha(s) histórica(s) também pertencem a outro vínculo ativo — o push exclui essas linhas daqui automaticamente (fica só com o vínculo mais antigo), então este vínculo soma normalmente só as linhas exclusivas dele. Exemplo: ${exemplos}.`;
  }

  revalidatePath(CLICKUP_ADMIN_PATH);
  return { ok: "Vínculo criado.", aviso };
}

export async function alternarVinculoAction(id: string, ativo: boolean): Promise<void> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) throw new Error(auth.error);
  await prisma.clickUpVinculo.update({ where: { id }, data: { ativo } });
  revalidatePath(CLICKUP_ADMIN_PATH);
}

/** Apaga o vínculo (e seu histórico de push, via cascade) — nunca mexe em RevenueCategorizedLine, só para de espelhar. */
export async function excluirVinculoAction(_prev: VinculoFormState, formData: FormData): Promise<VinculoFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Vínculo inválido." };

  await prisma.clickUpVinculo.delete({ where: { id } }).catch((err) => {
    if ((err as { code?: string })?.code === "P2025") return; // já não existia — some do mesmo jeito, sem erro
    throw err;
  });

  revalidatePath(CLICKUP_ADMIN_PATH);
  return { ok: "Vínculo removido." };
}

export interface PushAgoraState {
  error?: string;
  ok?: string;
}

/** Botão "Empurrar agora" — ignora a checagem de "valor mudou?", serve para testar um vínculo sem esperar a próxima rodada. */
export async function empurrarAgoraAction(_prev: PushAgoraState, formData: FormData): Promise<PushAgoraState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };
  const vinculoId = String(formData.get("vinculoId") ?? "");
  if (!vinculoId) return { error: "Vínculo inválido." };

  const resultado = await pushVinculoAgora(vinculoId);
  revalidatePath(CLICKUP_ADMIN_PATH);
  if (!resultado.sucesso) return { error: resultado.erro ?? "Falha ao empurrar." };
  return { ok: `Enviado: ${formatBRL(resultado.valorEnviado)}` };
}

// -----------------------------------------------------------------------
// Detalhamento: quais faturas compõem o valor de um vínculo.
// -----------------------------------------------------------------------

export interface DetalheState {
  error?: string;
  /** Mês apurado (o mesmo do último envio mostrado na linha, ou o mês corrente se nunca enviou). */
  ano?: number;
  mes?: number;
  incluidas?: LinhaDaComposicao[];
  excluidas?: LinhaExcluidaDaComposicao[];
  /** Soma RECALCULADA agora das linhas incluídas. */
  totalAtual?: string;
  /** Último valor que de fato chegou ao ClickUp neste mês (só push com sucesso), ou null. */
  ultimoEnviado?: { valor: string; enviadoEm: string } | null;
  /** true quando o recálculo difere do último enviado — a receita mudou desde o envio. */
  divergente?: boolean;
}

/**
 * Lista as faturas que compõem o valor de UM vínculo, para o mês do último
 * envio (ou o mês corrente, se nunca enviou).
 *
 * Ponto honesto e não negociável desta tela: `ClickUpPushLog` guarda só o
 * TOTAL, nunca quais linhas o compuseram — então esta lista é sempre um
 * RECÁLCULO com os dados de agora, não um retrato do que foi somado no envio.
 * As duas coisas divergem por motivos legítimos e frequentes (a receita do mês
 * corrente muda a cada sincronização de 15 min; uma revisão manual pode ter
 * trocado categoria/valor; `devePush` pula reenvio quando nada muda). Por isso
 * o retorno traz os DOIS números e um sinalizador — a UI mostra a divergência
 * em vez de escondê-la atrás de um total que "parece" o do ClickUp.
 */
export async function detalharVinculoAction(vinculoId: string): Promise<DetalheState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };
  if (!vinculoId) return { error: "Vínculo inválido." };

  const vinculo = await prisma.clickUpVinculo.findUnique({ where: { id: vinculoId } });
  if (!vinculo) return { error: "Vínculo não encontrado." };

  // O mês apurado segue o que a linha da tabela mostra (último envio, com ou
  // sem sucesso); sem nenhum envio ainda, cai no mês corrente — que é o que o
  // próximo push vai empurrar.
  const ultimoPush = await prisma.clickUpPushLog.findFirst({
    where: { vinculoId },
    orderBy: { enviadoEm: "desc" },
    select: { ano: true, mes: true },
  });
  const corrente = periodoCorrente();
  const ano = ultimoPush?.ano ?? corrente.ano;
  const mes = ultimoPush?.mes ?? corrente.mes;
  const { fromDate, toDateExclusive } = limitesDoMes(ano, mes);

  // Mesma vizinhança que o push considera: só vínculos ATIVOS da mesma
  // categoria disputam linhas (ver composicao.ts, filtro 4).
  const outrosAtivos = await prisma.clickUpVinculo.findMany({
    where: { categoria: vinculo.categoria, ativo: true, id: { not: vinculo.id } },
  });

  let composicao;
  try {
    composicao = await composicaoDoVinculo(vinculo, outrosAtivos, fromDate, toDateExclusive);
  } catch (err) {
    // Vínculo sem padrão nenhum (PadroesVazioError) cai aqui — é o mesmo erro
    // que derrubaria o push, então mostrar na tela é melhor que uma lista vazia.
    return { error: err instanceof Error ? err.message : String(err) };
  }

  // Só push com SUCESSO representa o que está no campo do ClickUp: um log com
  // falha grava `valorEnviado` que nunca chegou lá (às vezes 0,00).
  const ultimoSucesso = await prisma.clickUpPushLog.findFirst({
    where: { vinculoId, ano, mes, sucesso: true },
    orderBy: { enviadoEm: "desc" },
    select: { valorEnviado: true, enviadoEm: true },
  });

  const totalAtual = toAmountString(composicao.total);
  const ultimoEnviado = ultimoSucesso
    ? { valor: ultimoSucesso.valorEnviado.toString(), enviadoEm: ultimoSucesso.enviadoEm.toISOString() }
    : null;

  return {
    ano,
    mes,
    incluidas: composicao.incluidas,
    excluidas: composicao.excluidas,
    totalAtual,
    ultimoEnviado,
    divergente: ultimoEnviado !== null && !money(ultimoEnviado.valor).equals(composicao.total),
  };
}
