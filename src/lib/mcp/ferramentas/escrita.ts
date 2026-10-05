import "server-only";
import { z } from "zod";
import type { MetaGranularidade, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, roundMoney, toAmountString } from "@/lib/money";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { startCategorizationRun } from "@/lib/categorization/run";
import { classificarConflito, type LinhaConflito } from "@/lib/categorization/conflitos";
import { SEM_CATEGORIA } from "@/lib/categorization/rules";
import { ANO_MES_RE, ANO_TRIMESTRE_RE } from "@/lib/metas/periodo";
import { ferramenta, type Ferramenta } from "../tipos";
import { dataIso, din, iso, paraData, valorDecimal } from "./comum";

/**
 * FERRAMENTAS DE ESCRITA (ADR-0033) — só com token de escopo ESCRITA, e cuja pessoa
 * dona seja ADMIN (VIEWER nunca escreve, mesmo com token de escrita).
 *
 * ⚠ ESTAS FUNÇÕES REPLICAM a lógica das ações da tela (categorization/actions.ts,
 * metas/actions.ts, conflitos-actions.ts) em vez de chamá-las. Decisão deliberada: as
 * ações da tela embutem a checagem de sessão e o `revalidatePath`, e refatorá-las
 * mexeria no que está em produção e funcionando. O custo é DUPLICAÇÃO — se a regra de
 * uma delas mudar, mude aqui também (cada função aponta a origem). Os testes de
 * integração (ver docs/context/mcp.md) travam os invariantes que importam: snapshot
 * original só na primeira revisão, Serializable, e revisão manual nunca sobrescrita.
 *
 * ⚠ Toda escrita devolve `_auditoria` com o estado ANTERIOR; o protocolo o separa e
 * grava em auditoria_mcp, e ele NÃO volta ao cliente.
 */

const PERIODO_MAX_DIAS = 400;

/** Linha de receita sem o `raw` (grande, e regenerável pela próxima sincronização). */
function instantaneo(l: Record<string, unknown>) {
  const { raw: _raw, ...resto } = l;
  return resto;
}

function ehConflitoDeConcorrencia(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2034";
}
const MSG_CONCORRENCIA = "Conflito de concorrência (uma sincronização rodava ao mesmo tempo) — tente novamente.";

// ---------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------

const dispararSincronizacao = ferramenta({
  nome: "disparar_sincronizacao",
  titulo: "Disparar sincronização de receita",
  descricao:
    "Roda uma sincronização de receita de um período (baixa os exports do Conexa, categoriza e grava), como o botão da tela Sincronizações. " +
    "⚠ HOJE FALHA: o Conexa exige reCAPTCHA no login web (2026-10-05) — não tente em laço. " +
    "⚠ Um período que começa antes do mês corrente RECATEGORIZA o mês com as regras de hoje: o total pode não mudar, mas a quebra por categoria e as metas mudam. Por isso exige `confirmarMesFechado: true`, e você só deve passar isso depois de AVISAR o usuário. " +
    "Fala com o Conexa e demora (minutos).",
  entrada: z.object({
    periodoInicio: dataIso,
    periodoFim: dataIso,
    confirmarMesFechado: z.boolean().default(false).describe("Só true depois de o usuário ter confirmado que quer recategorizar um mês fechado."),
  }),
  somenteLeitura: false,
  mundoAberto: true,
  executar: async (a, ctx) => {
    const inicio = paraData(a.periodoInicio);
    const fim = paraData(a.periodoFim);
    if (inicio > fim) throw new Error("periodoInicio não pode ser depois de periodoFim.");
    if ((fim.getTime() - inicio.getTime()) / 86_400_000 > PERIODO_MAX_DIAS) {
      throw new Error(`Período grande demais (máx. ${PERIODO_MAX_DIAS} dias). Divida em partes.`);
    }
    const hoje = keyToUtcDate(todayKey());
    const primeiroDoMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
    if (inicio < primeiroDoMes && !a.confirmarMesFechado) {
      throw new Error(
        "Este período começa antes do mês corrente: reprocessá-lo RECATEGORIZA o mês com as regras de hoje (o total pode não mudar, mas a quebra por categoria e as METAS mudam). " +
          "Avise o usuário, e só então repita com confirmarMesFechado=true.",
      );
    }
    const runId = await startCategorizationRun({ periodoInicio: inicio, periodoFim: fim, executadoPorId: ctx.userId, origem: "MANUAL" });
    const run = await prisma.revenueSyncRun.findUniqueOrThrow({ where: { id: runId } });
    return {
      rodadaId: runId,
      status: run.status,
      periodo: `${a.periodoInicio}..${a.periodoFim}`,
      totalRecebido: din(run.totalRecebido),
      diferencaConferencia: din(run.diferencaConferencia),
      novas: run.totalLinhasNovas,
      atualizadas: run.totalLinhasAtualizadas,
      orfasPreservadas: run.totalLinhasOrfasPreservadas,
      faturasComConflito: run.totalFaturasComConflito,
      _auditoria: { periodoRecategorizado: inicio < primeiroDoMes },
    };
  },
});

// ---------------------------------------------------------------------------
// Revisão de linha  (origem: categorization/actions.ts::updateCategorizedLineAction)
// ---------------------------------------------------------------------------

class LinhaNaoEncontrada extends Error {}

const revisarLinha = ferramenta({
  nome: "revisar_linha",
  titulo: "Revisar uma linha de receita",
  descricao:
    "Corrige a categoria e o valor de UMA linha de receita (como a tela Revisar). A correção fica CONGELADA: nenhuma sincronização a sobrescreve. O valor que a skill calculou é guardado em valorRecebidoCatOriginal na PRIMEIRA revisão e nunca é sobrescrito. " +
    "Mexe em dinheiro apurado: leia a linha antes (detalhar_fatura) e diga ao usuário categoria e valor antes→depois. `valor` é decimal com ponto (\"123.45\"). Para mover receita entre faturas ou apagar, esta NÃO é a ferramenta.",
  entrada: z.object({
    lineId: z.string().min(1).describe("O `id` da linha (de buscar_linhas ou detalhar_fatura)."),
    categoria: z.string().trim().min(1).max(120),
    valor: valorDecimal,
  }),
  somenteLeitura: false,
  idempotente: true,
  executar: async (a, ctx) => {
    const novoValor = roundMoney(money(a.valor));
    let antes: Record<string, unknown> = {};
    try {
      await prisma.$transaction(
        async (tx) => {
          const linha = await tx.revenueCategorizedLine.findUnique({ where: { id: a.lineId } });
          if (!linha) throw new LinhaNaoEncontrada();
          antes = { categoria: linha.categoria, valorRecebidoCat: din(linha.valorRecebidoCat), revisadoManualmente: linha.revisadoManualmente, crConexaId: linha.crConexaId, mesCredito: linha.mesCredito };
          await tx.revenueCategorizedLine.update({
            where: { id: linha.id },
            data: {
              categoria: a.categoria,
              valorRecebidoCat: toAmountString(novoValor),
              revisadoManualmente: true,
              revisadoPorId: ctx.userId,
              revisadoEm: new Date(),
              // Snapshot só na PRIMEIRA revisão — preserva o que a skill calculou.
              ...(linha.revisadoManualmente ? {} : { categoriaOriginal: linha.categoria, valorRecebidoCatOriginal: linha.valorRecebidoCat }),
            },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (err instanceof LinhaNaoEncontrada) throw new Error(`Linha ${a.lineId} não encontrada.`);
      if (ehConflitoDeConcorrencia(err)) throw new Error(MSG_CONCORRENCIA);
      throw err;
    }
    return {
      ok: true,
      lineId: a.lineId,
      antes,
      depois: { categoria: a.categoria, valorRecebidoCat: toAmountString(novoValor), revisadoManualmente: true },
      _auditoria: { antes },
    };
  },
});

// ---------------------------------------------------------------------------
// Regras de categoria  (origem: categorization/actions.ts::create/toggleCategoryRuleAction)
// ---------------------------------------------------------------------------

const salvarRegra = ferramenta({
  nome: "salvar_regra_categoria",
  titulo: "Salvar regra de categoria",
  descricao:
    "Cria a regra nome→categoria, ou ATUALIZA a categoria se o nome já existe (e a reativa). `nome` é o nome EXATO do serviço/plano: só trim, espaço duplo interno é real e preservado. " +
    "⚠ A regra governa TODOS os números futuros, mas NÃO mexe nas linhas já gravadas: para refletir, é preciso sincronizar o período (hoje bloqueado pelo captcha). Devolve quantas linhas 'Sem Categoria' esse nome já tem.",
  entrada: z.object({ nome: z.string().trim().min(1).max(300), categoria: z.string().trim().min(1).max(120) }),
  somenteLeitura: false,
  idempotente: true,
  executar: async (a) => {
    const antes = await prisma.revenueCategoryRule.findUnique({ where: { nome: a.nome } });
    const regra = await prisma.revenueCategoryRule.upsert({
      where: { nome: a.nome },
      update: { categoria: a.categoria, ativo: true },
      create: { nome: a.nome, categoria: a.categoria },
    });
    const pend = await prisma.revenueCategorizedLine.aggregate({
      where: { servicoOuPlano: a.nome, categoria: SEM_CATEGORIA },
      _count: { _all: true },
      _min: { dataCredito: true },
      _max: { dataCredito: true },
    });
    return {
      acao: antes ? "atualizada" : "criada",
      regra: { id: regra.id, nome: regra.nome, categoria: regra.categoria, ativo: regra.ativo },
      linhasAindaSemCategoria: pend._count._all,
      intervalo: pend._count._all ? `${iso(pend._min.dataCredito)}..${iso(pend._max.dataCredito)}` : null,
      aviso: pend._count._all
        ? "Essas linhas continuam 'Sem Categoria' até uma sincronização do intervalo (recategoriza com as regras de hoje)."
        : undefined,
      _auditoria: { antes: antes ? { categoria: antes.categoria, ativo: antes.ativo } : null },
    };
  },
});

const alternarRegra = ferramenta({
  nome: "alternar_regra_categoria",
  titulo: "Ligar ou desligar regra",
  descricao: "Liga ou desliga uma regra pelo NOME exato. Desligar faz o serviço voltar a 'Sem Categoria' na próxima sincronização do período; não mexe nas linhas já gravadas.",
  entrada: z.object({ nome: z.string().trim().min(1), ativo: z.boolean() }),
  somenteLeitura: false,
  idempotente: true,
  executar: async (a) => {
    const antes = await prisma.revenueCategoryRule.findUnique({ where: { nome: a.nome } });
    if (!antes) throw new Error(`Regra "${a.nome}" não existe. Use listar_regras para achar o nome exato.`);
    const r = await prisma.revenueCategoryRule.update({ where: { id: antes.id }, data: { ativo: a.ativo } });
    return { nome: r.nome, categoria: r.categoria, ativo: r.ativo, _auditoria: { antes: { ativo: antes.ativo } } };
  },
});

// ---------------------------------------------------------------------------
// Metas  (origem: metas/actions.ts::definirMetaAction / removerMetaAction)
// ---------------------------------------------------------------------------

/** Períodos-átomo de `periodoChave` até o fim do MESMO ano (inclusive). Cópia de metas/actions.ts. */
function periodosAteFimDoAno(granularidade: MetaGranularidade, periodoChave: string): string[] {
  if (granularidade === "TRIMESTRE") {
    const [ano, q] = periodoChave.split("-Q").map(Number);
    const out: string[] = [];
    for (let t = q!; t <= 4; t++) out.push(`${ano}-Q${t}`);
    return out;
  }
  const [ano, mes] = periodoChave.split("-").map(Number);
  const out: string[] = [];
  for (let m = mes!; m <= 12; m++) out.push(`${ano}-${String(m).padStart(2, "0")}`);
  return out;
}

const chaveDoPeriodo = (g: MetaGranularidade, c: string) => (g === "MES" ? ANO_MES_RE.test(c) : ANO_TRIMESTRE_RE.test(c));

const definirMeta = ferramenta({
  nome: "definir_meta",
  titulo: "Definir meta",
  descricao:
    "Define a meta de um escopo num período (mensal AAAA-MM ou trimestral AAAA-Q#), e registra a mudança no histórico. Com `repetirAteFimDoAno`, aplica o mesmo valor até dezembro. Regravar o mesmo valor não é alteração. " +
    "Meta é o número contra o qual a equipe é avaliada: diga ao usuário valor antes→depois. Veja os escopos em consultar_metas.",
  entrada: z.object({
    escopoSlug: z.string().min(1),
    granularidade: z.enum(["MES", "TRIMESTRE"]),
    periodoChave: z.string().describe('MES: "2026-10"; TRIMESTRE: "2026-Q4".'),
    valor: valorDecimal,
    repetirAteFimDoAno: z.boolean().default(false),
  }),
  somenteLeitura: false,
  idempotente: true,
  executar: async (a, ctx) => {
    if (!chaveDoPeriodo(a.granularidade, a.periodoChave)) {
      throw new Error(a.granularidade === "MES" ? "Período inválido: esperado AAAA-MM." : "Período inválido: esperado AAAA-Q# (ex.: 2026-Q4).");
    }
    const valor = roundMoney(money(a.valor));
    const escopo = await prisma.metaEscopo.findUnique({ where: { slug: a.escopoSlug } });
    if (!escopo) throw new Error(`Escopo "${a.escopoSlug}" não encontrado. Veja consultar_metas.`);

    const periodos = a.repetirAteFimDoAno ? periodosAteFimDoAno(a.granularidade, a.periodoChave) : [a.periodoChave];
    const valorStr = toAmountString(valor);
    const alterados: Array<{ periodo: string; de: string | null; para: string }> = [];

    // Uma transação: gravar a meta e o evento são um fato só (financial-rigor #9).
    await prisma.$transaction(async (tx) => {
      for (const periodoChave of periodos) {
        const atual = await tx.metaPeriodo.findUnique({
          where: { escopoId_granularidade_periodoChave: { escopoId: escopo.id, granularidade: a.granularidade, periodoChave } },
          select: { id: true, valor: true },
        });
        // Comparação NUMÉRICA: Decimal.toString() de 35000.00 é "35000", que nunca é igual a
        // "35000.00" — comparar texto fazia toda regravação virar uma alteração falsa no histórico.
        if (atual && atual.valor.equals(valor)) continue;
        const salvo = await tx.metaPeriodo.upsert({
          where: { escopoId_granularidade_periodoChave: { escopoId: escopo.id, granularidade: a.granularidade, periodoChave } },
          update: { valor: valorStr, definidoPorId: ctx.userId },
          create: { escopoId: escopo.id, granularidade: a.granularidade, periodoChave, valor: valorStr, definidoPorId: ctx.userId },
        });
        await tx.metaPeriodoEvent.create({
          data: { metaPeriodoId: salvo.id, valorAnterior: atual?.valor ?? null, valorNovo: valorStr, alteradoPorId: ctx.userId },
        });
        alterados.push({ periodo: periodoChave, de: atual ? atual.valor.toString() : null, para: valorStr });
      }
    });
    return { escopo: escopo.nome, solicitados: periodos.length, alterados, semMudanca: periodos.length - alterados.length, _auditoria: { antes: alterados.map((x) => ({ periodo: x.periodo, valor: x.de })) } };
  },
});

const removerMeta = ferramenta({
  nome: "remover_meta",
  titulo: "Remover meta",
  descricao:
    "Remove a meta de um escopo num período (volta a 'sem meta definida'). ⚠ APAGA também o histórico de alterações dessa meta (cascata) — por isso o valor e os eventos ficam no rastro de auditoria. Exige `confirmarRemocao: true`, depois de o usuário confirmar o escopo e o período exatos.",
  entrada: z.object({
    escopoSlug: z.string().min(1),
    granularidade: z.enum(["MES", "TRIMESTRE"]),
    periodoChave: z.string(),
    confirmarRemocao: z.literal(true, { message: "confirmarRemocao precisa ser true (e só depois de o usuário confirmar)." }),
  }),
  somenteLeitura: false,
  destrutiva: true,
  executar: async (a) => {
    const escopo = await prisma.metaEscopo.findUnique({ where: { slug: a.escopoSlug } });
    if (!escopo) throw new Error(`Escopo "${a.escopoSlug}" não encontrado.`);
    const meta = await prisma.metaPeriodo.findUnique({
      where: { escopoId_granularidade_periodoChave: { escopoId: escopo.id, granularidade: a.granularidade, periodoChave: a.periodoChave } },
      include: { eventos: { orderBy: { criadoEm: "asc" } } },
    });
    if (!meta) throw new Error(`Não há meta de "${escopo.nome}" em ${a.periodoChave}.`);
    await prisma.metaPeriodo.delete({ where: { id: meta.id } });
    return {
      removida: { escopo: escopo.nome, periodo: meta.periodoChave, valor: din(meta.valor) },
      _auditoria: { meta: { escopo: escopo.slug, granularidade: meta.granularidade, periodo: meta.periodoChave, valor: din(meta.valor) }, eventos: meta.eventos.map((e) => ({ quando: e.criadoEm, de: din(e.valorAnterior), para: din(e.valorNovo) })) },
    };
  },
});

// ---------------------------------------------------------------------------
// Conflitos  (origem: categorization/conflitos-actions.ts)
// ---------------------------------------------------------------------------

const resolverConflito = ferramenta({
  nome: "resolver_conflito",
  titulo: "Resolver conflito automaticamente",
  descricao:
    "Resolve UM conflito só quando a classificação é inequívoca (manual_superada ou duplicata_sem_categoria): APAGA a linha redundante, re-classificando com dado fresco dentro da transação. Se o caso for 'ambiguo', RECUSA — aí a decisão é do usuário (use excluir_linha na linha certa, depois de ele escolher). Veja listar_conflitos antes.",
  entrada: z.object({ crConexaId: z.number().int() }),
  somenteLeitura: false,
  destrutiva: true,
  executar: async ({ crConexaId }) => {
    let apagada: Record<string, unknown> | null = null;
    let mensagem = "";
    try {
      await prisma.$transaction(
        async (tx) => {
          const linhas = await tx.revenueCategorizedLine.findMany({ where: { crConexaId }, include: { revisadoPor: { select: { name: true, email: true } } } });
          const formatadas: LinhaConflito[] = linhas.map((l) => ({
            id: l.id, categoria: l.categoria, chaveLinha: l.chaveLinha, servicoOuPlano: l.servicoOuPlano,
            valorRecebidoCat: l.valorRecebidoCat.toString(), revisadoManualmente: l.revisadoManualmente,
            revisadoPorNome: l.revisadoPor?.name ?? l.revisadoPor?.email ?? null, revisadoEm: l.revisadoEm?.toISOString() ?? null,
            categoriaOriginal: l.categoriaOriginal, valorRecebidoCatOriginal: l.valorRecebidoCatOriginal?.toString() ?? null,
          }));
          const c = classificarConflito(formatadas);
          if (c.tipo === "ambiguo") {
            throw new Error("Este caso é AMBÍGUO (as categorias das linhas divergem): não se resolve sozinho. Peça ao usuário para escolher qual linha excluir e use excluir_linha.");
          }
          const alvo = linhas.find((l) => l.id === c.linhaParaExcluirId);
          apagada = alvo ? instantaneo(alvo as unknown as Record<string, unknown>) : null;
          await tx.revenueCategorizedLine.delete({ where: { id: c.linhaParaExcluirId } });
          if (c.tipo === "manual_superada") {
            mensagem = "Linha manual redundante removida (uma regra real já categoriza esta fatura).";
            return;
          }
          // duplicata_sem_categoria: exclui a automática PRIMEIRO (libera a chave) e só então re-chaveia a manual.
          await tx.revenueCategorizedLine.update({ where: { id: c.linhaParaRechavearId }, data: { chaveLinha: c.novaChave } });
          mensagem = `Duplicata removida e a linha manual re-chaveada para "${c.novaChave}".`;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (ehConflitoDeConcorrencia(err)) throw new Error(MSG_CONCORRENCIA);
      throw err;
    }
    return { ok: true, crConexaId, resultado: mensagem, _auditoria: { linhaApagada: apagada } };
  },
});

const excluirLinha = ferramenta({
  nome: "excluir_linha",
  titulo: "Excluir uma linha de receita",
  descricao:
    "Exclui UMA linha de receita por id — para os casos 'ambíguos' que resolver_conflito recusa. IRREVERSÍVEL pelo painel (a linha inteira, sem o raw, fica no rastro de auditoria). Se a fatura ainda existir no Conexa, a próxima sincronização do mês a recria. " +
    "Exige `confirmarExclusao: true`: nunca passe isso sem o usuário ter confirmado A LINHA EXATA (fatura, categoria e valor — mostre antes com detalhar_fatura). Não use para apagar em massa.",
  entrada: z.object({
    lineId: z.string().min(1),
    confirmarExclusao: z.literal(true, { message: "confirmarExclusao precisa ser true (e só depois de o usuário confirmar a linha exata)." }),
  }),
  somenteLeitura: false,
  destrutiva: true,
  executar: async ({ lineId }) => {
    let apagada: Record<string, unknown> = {};
    try {
      await prisma.$transaction(
        async (tx) => {
          const linha = await tx.revenueCategorizedLine.findUnique({ where: { id: lineId } });
          if (!linha) throw new Error("Linha não encontrada (talvez já excluída).");
          apagada = instantaneo(linha as unknown as Record<string, unknown>);
          await tx.revenueCategorizedLine.delete({ where: { id: lineId } });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (ehConflitoDeConcorrencia(err)) throw new Error(MSG_CONCORRENCIA);
      throw err;
    }
    return { ok: true, excluida: { id: lineId, crConexaId: apagada.crConexaId, categoria: apagada.categoria, valorRecebidoCat: din(apagada.valorRecebidoCat as { toString(): string }), mesCredito: apagada.mesCredito }, _auditoria: { linhaApagada: apagada } };
  },
});

export const ferramentasDeEscrita: Ferramenta[] = [
  dispararSincronizacao, revisarLinha, salvarRegra, alternarRegra, definirMeta, removerMeta, resolverConflito, excluirLinha,
];

// Reexporta para os testes de esquema conferirem o que cada uma anuncia.
export type { Prisma };
