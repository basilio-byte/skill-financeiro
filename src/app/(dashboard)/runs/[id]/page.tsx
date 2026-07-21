import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const PROPORCIONADO_LABEL: Record<string, string> = {
  N: "N",
  S: "S — rateado (revisar)",
  SEM_LV: "Sem LV (revisar)",
};

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.revenueCategorizationRun.findUnique({ where: { id } });
  if (!run) notFound();

  const linhasParaRevisar = await prisma.revenueCategorizedLine.findMany({
    where: { runId: id, proporcionado: { in: ["S", "SEM_LV"] } },
    orderBy: { crConexaId: "asc" },
    take: 200,
  });

  const resumo = (run.resumoPorCategoria as Array<{ categoria: string; total: string }> | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Rodada {formatDate(run.periodoInicio)} – {formatDate(run.periodoFim)}
        </h1>
        <p className="text-sm text-slate-500">
          Status: {run.status} · Faturas CR: {run.totalLinhasCR} · Itens LV: {run.totalLinhasLV} · Sem LV:{" "}
          {run.totalSemLV}
        </p>
        {run.erro ? <p className="mt-2 text-sm text-red-600">Erro: {run.erro}</p> : null}
      </div>

      {run.status === "DONE" ? (
        <a className="btn" href={`/api/runs/${run.id}/export`}>
          Baixar planilha (.xlsx)
        </a>
      ) : null}

      <div className="card">
        <h2 className="mb-4 font-semibold text-slate-900">Resumo por categoria</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {resumo.map((r) => (
              <tr key={r.categoria} className="border-t border-slate-100">
                <td className="py-2 pr-4">{r.categoria}</td>
                <td className="py-2 pr-4">{formatBRL(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-2 pr-4">Total geral</td>
              <td className="py-2 pr-4">{formatBRL(run.totalRecebido.toString())}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-1 font-semibold text-slate-900">Faturas para revisar</h2>
        <p className="mb-4 text-sm text-slate-500">
          Rateadas entre categorias ("S") ou sem correspondência no Listar Vendas ("Sem LV").
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">CR ID</th>
              <th className="pb-2 pr-4">Cliente</th>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Proporcionado</th>
              <th className="pb-2 pr-4">Valor Cat.</th>
            </tr>
          </thead>
          <tbody>
            {linhasParaRevisar.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-2 pr-4">{l.crConexaId}</td>
                <td className="py-2 pr-4">{l.razaoSocial}</td>
                <td className="py-2 pr-4">{l.categoria}</td>
                <td className="py-2 pr-4">{PROPORCIONADO_LABEL[l.proporcionado] ?? l.proporcionado}</td>
                <td className="py-2 pr-4">{formatBRL(l.valorRecebidoCat.toString())}</td>
              </tr>
            ))}
            {linhasParaRevisar.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  Nada para revisar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
