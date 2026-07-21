import Link from "next/link";
import type { Metadata } from "next";
import { buildOverview } from "@/lib/reports/overview";
import { PERIOD_KINDS, type PeriodKind } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { KpiCard } from "@/components/kpi-card";
import { ChartCard } from "@/components/charts/chart-card";
import { PeriodBarChart } from "@/components/charts/period-bar-chart";
import { BreakdownList } from "@/components/breakdown-list";
import { ConfidenceBreakdown } from "@/components/confidence-breakdown";
import { PeriodControls } from "@/components/period-controls";

export const metadata: Metadata = { title: "Panorama" };

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const STATUS_LABEL: Record<string, string> = { RUNNING: "Sincronizando", DONE: "Concluída", FAILED: "Falhou" };

const VALID_KINDS = PERIOD_KINDS.map((k) => k.value);

export default async function PanoramaPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; ref?: string }>;
}) {
  const sp = await searchParams;
  const kind: PeriodKind = (VALID_KINDS as string[]).includes(sp.g ?? "") ? (sp.g as PeriodKind) : "month";

  const report = await buildOverview(kind, sp.ref);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Panorama</h1>
          <p className="text-sm capitalize text-slate-500">{report.periodo.label}</p>
        </div>
        <PeriodControls kind={kind} fromKey={report.periodo.fromKey} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total recebido no período"
          amount={report.totalRecebidoPeriodo}
          tone="positive"
          hint="por Data de Crédito da Cobrança"
        />
        <KpiCard
          label="Sem categoria no período"
          amount={report.totalSemCategoriaPeriodo}
          tone={report.percentualSemCategoria > 0 ? "negative" : "neutral"}
          sublabel={`${report.percentualSemCategoria}% do período`}
          hint="Revisar em /categorias"
        />
        <KpiCard label="Sincronizações concluídas" value={String(report.rodadasConcluidas)} hint="total do sistema" />
        <KpiCard label="Regras de categorização ativas" value={String(report.regrasCadastradas)} />
      </div>

      {/* Tendência — série única (uma matiz, sem legenda) */}
      <ChartCard
        title="Total recebido por período"
        hint={`últimos 12 períodos (${PERIOD_KINDS.find((k) => k.value === kind)?.label.toLowerCase()}) até o selecionado`}
        rows={report.tendencia.map((p) => ({ key: p.label, total: p.total }))}
        columns={[
          { key: "key", label: "Período" },
          { key: "total", label: "Total", money: true },
        ]}
      >
        <PeriodBarChart data={report.tendencia} />
      </ChartCard>

      {/* Breakdowns do período selecionado */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle hint={formatBRL(report.totalRecebidoPeriodo)}>Receita por categoria</SectionTitle>
          <BreakdownList items={report.porCategoria} emptyLabel="Nenhuma receita categorizada neste período" />
        </Card>
        <Card>
          <SectionTitle>Receita por conta</SectionTitle>
          <BreakdownList items={report.porConta} emptyLabel="Nenhuma receita categorizada neste período" />
        </Card>
        <Card className="lg:col-span-2">
          <SectionTitle hint='quanto da receita veio direto ("N"), rateada entre categorias ("S") ou sem correspondência no Listar Vendas ("Sem LV")'>
            Confiabilidade da categorização
          </SectionTitle>
          <ConfidenceBreakdown data={report.porConfianca} emptyLabel="Nenhuma receita categorizada neste período" />
        </Card>
      </div>

      {/* Últimas sincronizações (histórico geral, não escopado ao período) */}
      <Card>
        <SectionTitle hint="cada sincronização mostra o total que ELA calculou no momento — pode não bater com o Panorama acima, que reflete sincronizações e revisões manuais feitas depois">
          Últimas sincronizações
        </SectionTitle>
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
                    Nenhuma sincronização ainda —{" "}
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
          Ver todas as sincronizações →
        </Link>
      </Card>
    </div>
  );
}
