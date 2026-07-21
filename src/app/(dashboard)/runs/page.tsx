import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { NewRunForm } from "@/app/(dashboard)/runs/new-run-form";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Sincronizações" };

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h > 0) return `${h}h ${min}min`;
  if (min > 0) return `${min}min`;
  return "menos de 1min";
}

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "Sincronizando",
  DONE: "Concluída",
  FAILED: "Falhou",
};

const ORIGEM_LABEL: Record<string, string> = {
  MANUAL: "Manual",
  AUTOMATICO: "Automático",
};

export default async function RunsPage() {
  const runs = await prisma.revenueSyncRun.findMany({
    orderBy: { iniciadoEm: "desc" },
    take: 50,
  });
  const emAndamento = runs.filter((r) => r.status === "RUNNING");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sincronizações</h1>
        <p className="text-sm text-slate-500">Dispare uma nova categorização ou consulte o histórico.</p>
      </div>

      {emAndamento.length > 0 ? (
        <>
          <AutoRefresh />
          {emAndamento.map((run) => (
            <Card key={run.id} role="status" aria-live="polite" className="border-seahub-200 bg-seahub-50/40">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-seahub-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-seahub-600" />
                </span>
                <p className="text-sm font-medium text-seahub-700">
                  Sincronizando {formatDate(run.periodoInicio)} – {formatDate(run.periodoFim)} ·{" "}
                  {ORIGEM_LABEL[run.origem] ?? run.origem}
                </p>
              </div>
              <p className="mt-1 text-xs text-seahub-600">
                Em andamento há {formatElapsed(Date.now() - run.iniciadoEm.getTime())} — esta página se atualiza
                sozinha.
              </p>
              <Link href={`/runs/${run.id}`} className="mt-2 inline-block text-xs font-medium text-seahub-600 hover:text-seahub-700">
                Ver detalhes →
              </Link>
            </Card>
          ))}
        </>
      ) : null}

      <NewRunForm jaEmAndamento={emAndamento.length > 0} />

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${runs.length} sincronização(ões)`}>Histórico</SectionTitle>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Período</th>
              <th className="pb-2 pr-4">Origem</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Faturas CR</th>
              <th className="pb-2 pr-4">Sem LV</th>
              <th className="pb-2 pr-4">Total recebido</th>
              <th className="pb-2 pr-4">Iniciada em</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-slate-100">
                <td className="py-2 pr-4">
                  <Link href={`/runs/${run.id}`} className="text-seahub-600 hover:underline">
                    {formatDate(run.periodoInicio)} – {formatDate(run.periodoFim)}
                  </Link>
                </td>
                <td className="py-2 pr-4">{ORIGEM_LABEL[run.origem] ?? run.origem}</td>
                <td className="py-2 pr-4">{STATUS_LABEL[run.status] ?? run.status}</td>
                <td className="py-2 pr-4">{run.totalLinhasCR}</td>
                <td className="py-2 pr-4">{run.totalSemLV}</td>
                <td className="py-2 pr-4">{formatBRL(run.totalRecebido.toString())}</td>
                <td className="py-2 pr-4 text-slate-500">{run.iniciadoEm.toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Nenhuma sincronização ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
