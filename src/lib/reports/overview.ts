import "server-only";
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
    prisma.revenueCategorizedLine.findMany({
      where: {
        run: { status: "DONE" },
        dataCredito: { gte: janelaInicio, lt: periodo.toDateExclusive },
      },
      select: { categoria: true, conta: true, valorRecebidoCat: true, dataCredito: true },
    }),
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

  // Tendência: soma por bucket da mesma granularidade, dentro da janela ampla.
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
