import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { DefinirMetaForm, RemoverMetaForm } from "@/components/metas-form";
import { nowInAppTz } from "@/lib/dates";

export const metadata: Metadata = { title: "Metas" };

/**
 * Configuração de metas. Segue o padrão de /categorias e não o de /contas:
 * a página é visível para todo mundo (quem vê a meta no Panorama consegue
 * conferir de onde ela saiu), mas a ESCRITA é protegida por checkRole("ADMIN")
 * dentro da própria Server Action.
 */
export default async function MetasPage({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);

  const agora = nowInAppTz();
  const anoCorrente = agora.getUTCFullYear();
  const ano = /^\d{4}$/.test(sp.ano ?? "") ? Number(sp.ano) : anoCorrente;
  const mesPadrao = `${anoCorrente}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;

  const escopos = await prisma.metaEscopo.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: {
      categorias: { select: { categoria: true }, orderBy: { categoria: "asc" } },
      periodos: {
        where: { anoMes: { startsWith: `${ano}-` } },
        orderBy: { anoMes: "asc" },
        include: {
          definidoPor: { select: { name: true } },
          eventos: { orderBy: { criadoEm: "desc" }, take: 1, include: { alteradoPor: { select: { name: true } } } },
        },
      },
    },
  });

  const podeEditar = user.role === "ADMIN";
  const anos = [anoCorrente - 1, anoCorrente, anoCorrente + 1];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Metas</h1>
        <p className="text-sm text-slate-500">
          Meta mensal de receita por escopo, apurada por Data de Crédito da Cobrança — o mesmo critério do
          Panorama. Períodos maiores (trimestre, semestre, ano) somam as metas dos meses que eles contêm.
        </p>
      </div>

      <Card>
        <SectionTitle>Definir meta</SectionTitle>
        <DefinirMetaForm
          escopos={escopos.map((e) => ({ slug: e.slug, nome: e.nome }))}
          mesPadrao={mesPadrao}
          podeEditar={podeEditar}
        />
      </Card>

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Ano:</span>
        {anos.map((a) => (
          <Link
            key={a}
            href={`/metas?ano=${a}`}
            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
              a === ano ? "bg-seahub-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {a}
          </Link>
        ))}
      </div>

      {escopos.map((escopo) => (
        <Card key={escopo.id} className="overflow-x-auto">
          <SectionTitle hint={`${escopo.periodos.length} mês(es) com meta em ${ano}`}>{escopo.nome}</SectionTitle>

          <p className="mb-3 text-xs text-slate-500">
            Soma as categorias:{" "}
            {escopo.categorias.map((c, i) => (
              <span key={c.categoria}>
                {i > 0 ? " + " : ""}
                <code className="rounded bg-slate-100 px-1 py-0.5">{c.categoria}</code>
              </span>
            ))}
            {escopo.categorias.length > 1 ? (
              <span className="block pt-1 text-slate-400">
                São grafias diferentes da mesma categoria, geradas por caminhos distintos do sistema — todas
                somam nesta meta.
              </span>
            ) : null}
          </p>

          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4">Mês</th>
                <th className="pb-2 pr-4">Meta</th>
                <th className="pb-2 pr-4">Definida por</th>
                <th className="pb-2 pr-4">Última alteração</th>
                {podeEditar ? <th className="pb-2 pr-4" /> : null}
              </tr>
            </thead>
            <tbody>
              {escopo.periodos.map((p) => {
                const ultimo = p.eventos[0];
                const foiAlterada = ultimo?.valorAnterior != null;
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 tabular-nums">{p.anoMes}</td>
                    <td className="py-2 pr-4 tabular-nums font-medium">{formatBRL(p.valor.toString())}</td>
                    <td className="py-2 pr-4 text-slate-600">{p.definidoPor?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {foiAlterada
                        ? `de ${formatBRL(ultimo.valorAnterior!.toString())} por ${ultimo.alteradoPor?.name ?? "—"} em ${ultimo.criadoEm.toLocaleDateString("pt-BR")}`
                        : "valor original"}
                    </td>
                    {podeEditar ? (
                      <td className="py-2 pr-4">
                        <RemoverMetaForm metaPeriodoId={p.id} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {escopo.periodos.length === 0 ? (
                <tr>
                  <td colSpan={podeEditar ? 5 : 4} className="py-6 text-center text-slate-400">
                    Nenhuma meta definida para {ano}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ))}

      {escopos.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-slate-400">
            Nenhum escopo de meta cadastrado — rode <code>npm run db:seed-metas</code>.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
