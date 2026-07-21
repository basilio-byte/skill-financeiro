import Link from "next/link";
import type { Metadata } from "next";
import { buildOverview } from "@/lib/reports/overview";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { KpiCard } from "@/components/kpi-card";
import { ChartCard } from "@/components/charts/chart-card";
import { PeriodBarChart } from "@/components/charts/period-bar-chart";
import { BreakdownList } from "@/components/breakdown-list";

export const metadata: Metadata = { title: "Panorama" };

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const STATUS_LABEL: Record<string, string> = { RUNNING: "Rodando", DONE: "Concluída", FAILED: "Falhou" };

export default async function PanoramaPage() {
  const report = await buildOverview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Panorama</h1>
        <p className="text-sm text-slate-500">Receita categorizada em todas as rodadas concluídas.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total recebido categorizado"
          amount={report.totalRecebidoGeral}
          tone="positive"
          hint={`${report.rodadasConcluidas} rodada(s) concluída(s)`}
        />
        <KpiCard
          label="Sem categoria"
          amount={report.totalSemCategoria}
          tone={report.percentualSemCategoria > 0 ? "negative" : "neutral"}
          sublabel={`${report.percentualSemCategoria}% do total`}
          hint="Revisar em /categorias"
        />
        <KpiCard label="Rodadas concluídas" value={String(report.rodadasConcluidas)} />
        <KpiCard label="Regras de categorização ativas" value={String(report.regrasCadastradas)} />
      </div>

      {/* Total recebido por rodada — série única (uma matiz, sem legenda) */}
      <ChartCard
        title="Total recebido por rodada"
        hint="ordem cronológica pelo período de cada rodada"
        rows={report.porRodada.map((p) => ({ key: p.label, total: p.total }))}
        columns={[
          { key: "key", label: "Rodada" },
          { key: "total", label: "Total", money: true },
        ]}
      >
        <PeriodBarChart data={report.porRodada} />
      </ChartCard>

      {/* Breakdowns: categoria (ranking, magnitude) e conta */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle hint={formatBRL(report.totalRecebidoGeral)}>Receita por categoria</SectionTitle>
          <BreakdownList items={report.porCategoria} emptyLabel="Nenhuma rodada concluída ainda" />
        </Card>
        <Card>
          <SectionTitle>Receita por conta</SectionTitle>
          <BreakdownList items={report.porConta} emptyLabel="Nenhuma rodada concluída ainda" />
        </Card>
      </div>

      {/* Últimas rodadas */}
      <Card>
        <SectionTitle>Últimas rodadas</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4">Período</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.ultimasRodadas.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4">
                    <Link href={`/runs/${r.id}`} className="text-seahub-600 hover:underline">
                      {fmtDate(r.periodoInicio)} – {fmtDate(r.periodoFim)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="py-2 pr-4">{formatBRL(r.totalRecebido)}</td>
                </tr>
              ))}
              {report.ultimasRodadas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-400">
                    Nenhuma rodada ainda —{" "}
                    <Link href="/runs" className="text-seahub-600 hover:underline">
                      criar a primeira
                    </Link>
                    .
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Link href="/runs" className="mt-4 inline-block text-sm font-medium text-seahub-600 hover:text-seahub-700">
          Ver todas as rodadas →
        </Link>
      </Card>
    </div>
  );
}
