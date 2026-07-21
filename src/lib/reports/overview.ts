import "server-only";
import type { Prisma } from "@prisma/client";
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
  porConfianca: ConfiancaBreakdown;
  tendencia: PeriodPoint[];
  ultimasRodadas: Array<{ id: string; periodoInicio: Date; periodoFim: Date; status: string; totalRecebido: string }>;
}

/**
 * Composição da receita do período por `Proporcionado` — o mesmo flag que a
 * skill categoriza-receita já produz (ver reference-categoriza-receita-skill):
 * "unica" = categoria única (valor integral, alta confiança); "rateado" =
 * dividida entre categorias (revisar); "semLv" = sem item correspondente no
 * Listar Vendas, categoria só do nome do plano (revisar). Nunca exibido antes
 * — é sinal de qualidade de dado que já existe em toda linha, só não tinha
 * visualização própria.
 */
export interface ConfiancaBreakdown {
  unica: string;
  rateado: string;
  semLv: string;
}

const TREND_BUCKETS = 12;

interface LinhaAgregada {
  categoria: string;
  conta: string | null;
  proporcionado: "N" | "S" | "SEM_LV";
  valorRecebidoCat: Prisma.Decimal;
  dataCredito: Date | null;
}

/**
 * Linhas categorizadas na janela. Desde o modelo de upsert por fatura
 * (ADR-0013), cada bucket (`crConexaId`, `chaveLinha`) tem UMA linha atual só
 * — `@@unique([crConexaId, chaveLinha])` garante isso no banco — então uma
 * consulta direta já não soma a mesma receita duas vezes, mesmo que o mesmo
 * período tenha sido sincronizado várias vezes (antes disso, era preciso
 * deduplicar por leitura: ver ADR-0012, removido nesta mudança).
 */
async function linhasDaJanela(fromDate: Date, toDateExclusive: Date): Promise<LinhaAgregada[]> {
  return prisma.revenueCategorizedLine.findMany({
    where: { dataCredito: { gte: fromDate, lt: toDateExclusive } },
    select: { categoria: true, conta: true, proporcionado: true, valorRecebidoCat: true, dataCredito: true },
  });
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
    linhasDaJanela(janelaInicio, periodo.toDateExclusive),
    prisma.revenueCategoryRule.count({ where: { ativo: true } }),
    prisma.revenueSyncRun.count({ where: { status: "DONE" } }),
    prisma.revenueSyncRun.findMany({ orderBy: { iniciadoEm: "desc" }, take: 8 }),
  ]);

  const linhasPeriodo = linhasJanela.filter(
    (l) => l.dataCredito && l.dataCredito >= periodo.fromDate && l.dataCredito < periodo.toDateExclusive,
  );

  const porCategoriaMap = new Map<string, Money>();
  const porContaMap = new Map<string, Money>();
  let unicaTotal = ZERO;
  let rateadoTotal = ZERO;
  let semLvTotal = ZERO;
  for (const l of linhasPeriodo) {
    const valor = money(l.valorRecebidoCat.toString());
    porCategoriaMap.set(l.categoria, (porCategoriaMap.get(l.categoria) ?? ZERO).plus(valor));
    const contaKey = l.conta || "Sem conta informada";
    porContaMap.set(contaKey, (porContaMap.get(contaKey) ?? ZERO).plus(valor));
    if (l.proporcionado === "N") unicaTotal = unicaTotal.plus(valor);
    else if (l.proporcionado === "S") rateadoTotal = rateadoTotal.plus(valor);
    else semLvTotal = semLvTotal.plus(valor);
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
    porConfianca: {
      unica: toAmountString(roundMoney(unicaTotal)),
      rateado: toAmountString(roundMoney(rateadoTotal)),
      semLv: toAmountString(roundMoney(semLvTotal)),
    },
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
