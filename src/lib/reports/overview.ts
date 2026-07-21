import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, sum, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import { getPeriodBounds, shiftPeriodKey, type PeriodBounds, type PeriodKind } from "@/lib/dates";
import type { BreakdownItem } from "@/components/breakdown-list";
import type { PeriodPoint } from "@/components/charts/period-bar-chart";

export interface OverviewData {
  periodo: PeriodBounds;
  totalRecebidoPeriodo: string;
  totalSemCategoriaPeriodo: string;
  percentualSemCategoria: number;
  rodadasConcluidas: number;
  regrasCadastradas: number;
  porCategoria: BreakdownItem[];
  porConta: BreakdownItem[];
  tendencia: PeriodPoint[];
  ultimasRodadas: Array<{ id: string; periodoInicio: Date; periodoFim: Date; status: string; totalRecebido: string }>;
}

const TREND_BUCKETS = 12;

interface LinhaAgregada {
  categoria: string;
  conta: string | null;
  valorRecebidoCat: Prisma.Decimal;
  dataCredito: Date | null;
}

/**
 * Linhas categorizadas na janela, DEDUPLICADAS por fatura (`crConexaId`).
 *
 * Por quê: o usuário pode disparar uma rodada para um período que já rodou
 * antes (ex.: reprocessar depois de cadastrar uma categoria nova) — cada
 * rodada é um registro histórico independente e imutável (ver /runs), então
 * a MESMA fatura pode existir em várias rodadas concluídas que se sobrepõem.
 * Somar todas cegamente faz o Panorama contar a mesma receita várias vezes
 * (bug real encontrado pelo usuário: 3 rodadas do mesmo período triplicavam
 * o total).
 *
 * A "versão vencedora" de cada fatura é escolhida GLOBALMENTE (sem filtro de
 * data), em duas etapas de prioridade — achado numa verificação adversarial
 * (2026-07-21) contra a primeira versão desta função, que tinha dois bugs:
 *
 *  1. **Revisão manual sempre vence.** Se QUALQUER rodada concluída tem uma
 *     linha revisada manualmente (`revisadoManualmente`) para a fatura, essa
 *     linha vence — nunca uma rodada nova e não-relacionada (ex.: disparada
 *     para cadastrar categoria de OUTRO serviço) pode reverter silenciosamente
 *     uma correção humana. Entre múltiplas revisões da mesma fatura, vence a
 *     mais recente (`revisadoEm`). Isso é o que a regra permanente do projeto
 *     exige (financial-rigor.md #9): a única exceção ao output da skill é
 *     revisão manual, e ela nunca pode ser silenciosamente descartada.
 *  2. **Sem revisão: a rodada concluída mais recente vence** (`concluidoEm`).
 *
 * Crítico: essa escolha NÃO pode depender do filtro de data do período sendo
 * consultado — se dependesse (como a primeira versão fazia), uma fatura cujo
 * `dataCredito` mudou entre duas rodadas (dado real, o Conexa é um sistema
 * vivo) podia "vencer" com a versão antiga num período e com a versão nova em
 * outro, contando a mesma receita duas vezes em painéis de períodos
 * diferentes. Por isso o filtro de data só entra DEPOIS, no SELECT externo,
 * sobre a versão já escolhida.
 */
async function linhasDeduplicadasPorFatura(fromDate: Date, toDateExclusive: Date): Promise<LinhaAgregada[]> {
  return prisma.$queryRaw<LinhaAgregada[]>`
    WITH versao_vencedora_por_fatura AS (
      SELECT DISTINCT ON (l."crConexaId") l."crConexaId" AS "crConexaId", l."runId" AS "runId"
      FROM revenue_categorized_lines l
      INNER JOIN revenue_categorization_runs r ON r.id = l."runId"
      WHERE r.status = 'DONE'
      -- NULLS LAST: por construção toda rodada DONE tem concluidoEm (setados juntos em
      -- run.ts), mas não confiamos nisso silenciosamente. Empates (praticamente
      -- impossíveis na prática) desempatam por id da rodada, pro resultado ser determinístico.
      ORDER BY
        l."crConexaId",
        l."revisadoManualmente" DESC,
        l."revisadoEm" DESC NULLS LAST,
        r."concluidoEm" DESC NULLS LAST,
        r."id" DESC
    )
    SELECT l.categoria, l.conta, l."valorRecebidoCat", l."dataCredito"
    FROM revenue_categorized_lines l
    INNER JOIN versao_vencedora_por_fatura v ON v."crConexaId" = l."crConexaId" AND v."runId" = l."runId"
    WHERE l."dataCredito" >= ${fromDate} AND l."dataCredito" < ${toDateExclusive}
  `;
}

/**
 * Monta o Panorama para um período (semana/mês/trimestre/semestre/ano),
 * escopado por `dataCredito` — o mesmo campo que já organiza as rodadas
 * (Data de Crédito da Cobrança). KPIs/breakdowns são do período selecionado;
 * a tendência mostra os últimos `TREND_BUCKETS` buckets terminando nele.
 */
export async function buildOverview(kind: PeriodKind, ref?: string): Promise<OverviewData> {
  const periodo = getPeriodBounds(kind, ref);

  const primeiroBucketKey = (() => {
    let k = periodo.fromKey;
    for (let i = 0; i < TREND_BUCKETS - 1; i++) k = shiftPeriodKey(k, kind, -1);
    return k;
  })();
  const janelaInicio = getPeriodBounds(kind, primeiroBucketKey).fromDate;

  const [linhasJanela, regrasCadastradas, rodadasConcluidas, ultimasRodadas] = await Promise.all([
    linhasDeduplicadasPorFatura(janelaInicio, periodo.toDateExclusive),
    prisma.revenueCategoryRule.count({ where: { ativo: true } }),
    prisma.revenueCategorizationRun.count({ where: { status: "DONE" } }),
    prisma.revenueCategorizationRun.findMany({ orderBy: { iniciadoEm: "desc" }, take: 8 }),
  ]);

  const linhasPeriodo = linhasJanela.filter(
    (l) => l.dataCredito && l.dataCredito >= periodo.fromDate && l.dataCredito < periodo.toDateExclusive,
  );

  const porCategoriaMap = new Map<string, Money>();
  const porContaMap = new Map<string, Money>();
  for (const l of linhasPeriodo) {
    const valor = money(l.valorRecebidoCat.toString());
    porCategoriaMap.set(l.categoria, (porCategoriaMap.get(l.categoria) ?? ZERO).plus(valor));
    const contaKey = l.conta || "Sem conta informada";
    porContaMap.set(contaKey, (porContaMap.get(contaKey) ?? ZERO).plus(valor));
  }
  const totalRecebidoPeriodo = sum(linhasPeriodo.map((l) => l.valorRecebidoCat.toString()));
  const totalSemCategoriaPeriodo = porCategoriaMap.get("Sem Categoria") ?? ZERO;

  const porCategoria: BreakdownItem[] = [...porCategoriaMap.entries()]
    .map(([categoria, total]) => ({ key: categoria, label: categoria, total: toAmountString(roundMoney(total)) }))
    .sort((a, b) => Number(b.total) - Number(a.total));
  const porConta: BreakdownItem[] = [...porContaMap.entries()]
    .map(([conta, total]) => ({ key: conta, label: conta, total: toAmountString(roundMoney(total)) }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  // Tendência: soma por bucket da mesma granularidade, dentro da janela ampla (já deduplicada).
  const buckets: PeriodBounds[] = [];
  let cursorKey = primeiroBucketKey;
  for (let i = 0; i < TREND_BUCKETS; i++) {
    buckets.push(getPeriodBounds(kind, cursorKey));
    cursorKey = shiftPeriodKey(cursorKey, kind, 1);
  }
  const somaPorBucket = new Map<string, Money>(buckets.map((b) => [b.fromKey, ZERO]));
  for (const l of linhasJanela) {
    if (!l.dataCredito) continue;
    const bucket = buckets.find((b) => l.dataCredito! >= b.fromDate && l.dataCredito! < b.toDateExclusive);
    if (bucket) {
      somaPorBucket.set(bucket.fromKey, (somaPorBucket.get(bucket.fromKey) ?? ZERO).plus(money(l.valorRecebidoCat.toString())));
    }
  }
  const tendencia: PeriodPoint[] = buckets.map((b) => ({
    key: b.fromKey,
    label: b.label,
    total: roundMoney(somaPorBucket.get(b.fromKey) ?? ZERO).toNumber(),
  }));

  return {
    periodo,
    totalRecebidoPeriodo: toAmountString(roundMoney(totalRecebidoPeriodo)),
    totalSemCategoriaPeriodo: toAmountString(roundMoney(totalSemCategoriaPeriodo)),
    percentualSemCategoria: totalRecebidoPeriodo.isZero()
      ? 0
      : Number(totalSemCategoriaPeriodo.div(totalRecebidoPeriodo).times(100).toFixed(1)),
    rodadasConcluidas,
    regrasCadastradas,
    porCategoria,
    porConta,
    tendencia,
    ultimasRodadas: ultimasRodadas.map((r) => ({
      id: r.id,
      periodoInicio: r.periodoInicio,
      periodoFim: r.periodoFim,
      status: r.status,
      totalRecebido: r.totalRecebido.toString(),
    })),
  };
}
