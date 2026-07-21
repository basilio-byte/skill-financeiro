import "server-only";
import { prisma } from "@/lib/db";
import { money, sum, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import type { BreakdownItem } from "@/components/breakdown-list";
import type { PeriodPoint } from "@/components/charts/period-bar-chart";

export interface OverviewData {
  totalRecebidoGeral: string;
  totalSemCategoria: string;
  percentualSemCategoria: number;
  rodadasConcluidas: number;
  regrasCadastradas: number;
  porCategoria: BreakdownItem[];
  porConta: BreakdownItem[];
  porRodada: PeriodPoint[];
  ultimasRodadas: Array<{ id: string; periodoInicio: Date; periodoFim: Date; status: string; totalRecebido: string }>;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/** Monta os dados do Panorama a partir das rodadas já concluídas. */
export async function buildOverview(): Promise<OverviewData> {
  const [runsDone, regrasCadastradas, ultimasRodadas, contaGroups] = await Promise.all([
    prisma.revenueCategorizationRun.findMany({ where: { status: "DONE" }, orderBy: { periodoInicio: "asc" } }),
    prisma.revenueCategoryRule.count({ where: { ativo: true } }),
    prisma.revenueCategorizationRun.findMany({ orderBy: { iniciadoEm: "desc" }, take: 8 }),
    prisma.revenueCategorizedLine.groupBy({
      by: ["conta"],
      where: { run: { status: "DONE" } },
      _sum: { valorRecebidoCat: true },
    }),
  ]);

  const totalRecebidoGeral = sum(runsDone.map((r) => r.totalRecebido.toString()));

  // Soma o resumoPorCategoria (já calculado por rodada) entre todas as rodadas —
  // evita reprocessar todas as linhas para o Panorama.
  const porCategoriaMap = new Map<string, Money>();
  for (const run of runsDone) {
    const resumo = (run.resumoPorCategoria as Array<{ categoria: string; total: string }> | null) ?? [];
    for (const r of resumo) {
      porCategoriaMap.set(r.categoria, (porCategoriaMap.get(r.categoria) ?? ZERO).plus(money(r.total)));
    }
  }
  const totalSemCategoria = porCategoriaMap.get("Sem Categoria") ?? ZERO;

  const porCategoria: BreakdownItem[] = [...porCategoriaMap.entries()]
    .map(([categoria, total]) => ({ key: categoria, label: categoria, total: toAmountString(roundMoney(total)) }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const porConta: BreakdownItem[] = contaGroups
    .map((g) => ({
      key: g.conta || "—",
      label: g.conta || "Sem conta informada",
      total: toAmountString(roundMoney(money(g._sum.valorRecebidoCat ?? 0))),
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const porRodada: PeriodPoint[] = runsDone.map((r) => ({
    key: r.id,
    label: `${fmtDate(r.periodoInicio)}–${fmtDate(r.periodoFim)}`,
    total: Number(r.totalRecebido),
  }));

  return {
    totalRecebidoGeral: toAmountString(roundMoney(totalRecebidoGeral)),
    totalSemCategoria: toAmountString(roundMoney(totalSemCategoria)),
    percentualSemCategoria: totalRecebidoGeral.isZero()
      ? 0
      : Number(totalSemCategoria.div(totalRecebidoGeral).times(100).toFixed(1)),
    rodadasConcluidas: runsDone.length,
    regrasCadastradas,
    porCategoria,
    porConta,
    porRodada,
    ultimasRodadas: ultimasRodadas.map((r) => ({
      id: r.id,
      periodoInicio: r.periodoInicio,
      periodoFim: r.periodoFim,
      status: r.status,
      totalRecebido: r.totalRecebido.toString(),
    })),
  };
}
