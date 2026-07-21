import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { NewRunForm } from "@/app/(dashboard)/runs/new-run-form";

export const metadata: Metadata = { title: "Rodadas" };

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "Rodando",
  DONE: "Concluída",
  FAILED: "Falhou",
};

export default async function RunsPage() {
  const runs = await prisma.revenueCategorizationRun.findMany({
    orderBy: { iniciadoEm: "desc" },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rodadas</h1>
        <p className="text-sm text-slate-500">Dispare uma nova categorização ou consulte o histórico.</p>
      </div>

      <NewRunForm />

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${runs.length} rodada(s)`}>Histórico</SectionTitle>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Período</th>
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
                <td className="py-2 pr-4">{STATUS_LABEL[run.status] ?? run.status}</td>
                <td className="py-2 pr-4">{run.totalLinhasCR}</td>
                <td className="py-2 pr-4">{run.totalSemLV}</td>
                <td className="py-2 pr-4">{formatBRL(run.totalRecebido.toString())}</td>
                <td className="py-2 pr-4 text-slate-500">{run.iniciadoEm.toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Nenhuma rodada ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
