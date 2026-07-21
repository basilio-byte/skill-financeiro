import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Card, SectionTitle } from "@/components/ui";
import { LinhaRevisaoRow, type LinhaRevisao } from "@/components/linha-revisao-row";

export const metadata: Metadata = { title: "Revisar" };

const TAKE = 200;

export default async function RevisarPage() {
  // Visão GLOBAL e sempre atual — desde o upsert por fatura (ADR-0013), uma
  // linha não pertence a uma rodada só, então "o que precisa de revisão" já
  // não é mais um conceito por-rodada (ver /runs/[id], que só mostra o que a
  // ÚLTIMA rodada tocou). Aqui é o inverso: todo o sistema, sem filtro de
  // rodada — não-revisadas primeiro, para funcionar como fila de trabalho.
  const [linhasRaw, totalPendentes] = await Promise.all([
    prisma.revenueCategorizedLine.findMany({
      where: { proporcionado: { in: ["S", "SEM_LV"] } },
      orderBy: [{ revisadoManualmente: "asc" }, { crConexaId: "asc" }],
      take: TAKE,
      include: { revisadoPor: { select: { name: true } } },
    }),
    prisma.revenueCategorizedLine.count({
      where: { proporcionado: { in: ["S", "SEM_LV"] }, revisadoManualmente: false },
    }),
  ]);

  const linhas: LinhaRevisao[] = linhasRaw.map((l) => ({
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Revisar</h1>
        <p className="text-sm text-slate-500">
          Todas as faturas rateadas ("S") ou sem correspondência no Listar Vendas ("Sem LV") do sistema, sempre
          atuais — não escopadas a uma rodada específica.
        </p>
      </div>

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${totalPendentes} pendente(s) de revisão`}>Faturas para revisar</SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          Categoria e valor aqui vêm calculados pela skill categoriza-receita. "Editar" corrige manualmente esta
          linha — a correção fica marcada e rastreada (quem, quando, valor original), e nunca é sobrescrita
          automaticamente depois, mesmo pela sincronização automática de 15 em 15 minutos.
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
            {linhas.map((l) => (
              <LinhaRevisaoRow key={l.id} linha={l} />
            ))}
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Nada para revisar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {linhasRaw.length === TAKE ? (
          <p className="mt-3 text-xs text-slate-400">Mostrando os primeiros {TAKE} — refine cadastrando categorias em /categorias.</p>
        ) : null}
      </Card>
    </div>
  );
}
