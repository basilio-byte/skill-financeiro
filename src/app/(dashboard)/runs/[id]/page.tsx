import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { LinhaRevisaoRow, type LinhaRevisao } from "@/components/linha-revisao-row";

export const metadata: Metadata = { title: "Detalhe da rodada" };

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.revenueCategorizationRun.findUnique({ where: { id } });
  if (!run) notFound();

  const linhasParaRevisarRaw = await prisma.revenueCategorizedLine.findMany({
    where: { runId: id, proporcionado: { in: ["S", "SEM_LV"] } },
    orderBy: { crConexaId: "asc" },
    take: 200,
    include: { revisadoPor: { select: { name: true } } },
  });

  const linhasParaRevisar: LinhaRevisao[] = linhasParaRevisarRaw.map((l) => ({
    id: l.id,
    crConexaId: l.crConexaId,
    razaoSocial: l.razaoSocial,
    servicoOuPlano: l.servicoOuPlano,
    categoria: l.categoria,
    proporcionado: l.proporcionado,
    valorRecebidoCat: l.valorRecebidoCat.toString(),
    revisadoManualmente: l.revisadoManualmente,
    revisadoPorNome: l.revisadoPor?.name ?? null,
    revisadoEm: l.revisadoEm?.toISOString() ?? null,
    categoriaOriginal: l.categoriaOriginal,
    valorRecebidoCatOriginal: l.valorRecebidoCatOriginal?.toString() ?? null,
  }));

  const resumo = (run.resumoPorCategoria as Array<{ categoria: string; total: string }> | null) ?? [];

  return (
    <div className="flex flex-col gap-6">
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
        <a className="btn w-fit" href={`/api/runs/${run.id}/export`}>
          Baixar planilha (.xlsx)
        </a>
      ) : null}

      <Card>
        <SectionTitle hint="reflete revisões manuais já feitas">Resumo por categoria</SectionTitle>
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
      </Card>

      <Card className="overflow-x-auto">
        <SectionTitle hint='rateadas ("S") ou sem correspondência no Listar Vendas ("Sem LV")'>
          Faturas para revisar
        </SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          Categoria e valor aqui vêm calculados pela skill categoriza-receita. "Editar" corrige manualmente esta
          linha — a correção fica marcada e rastreada (quem, quando, valor original), e nunca é sobrescrita
          automaticamente depois.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">CR ID</th>
              <th className="pb-2 pr-4">Cliente</th>
              <th className="pb-2 pr-4">Serviço/Plano</th>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Proporcionado</th>
              <th className="pb-2 pr-4">Valor Cat.</th>
              <th className="pb-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {linhasParaRevisar.map((l) => (
              <LinhaRevisaoRow key={l.id} linha={l} />
            ))}
            {linhasParaRevisar.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Nada para revisar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
