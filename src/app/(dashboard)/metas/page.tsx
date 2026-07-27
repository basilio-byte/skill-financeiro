import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { DefinirMetaForm, RemoverMetaForm } from "@/components/metas-form";
import { nowInAppTz } from "@/lib/dates";
import { trimestreDaData } from "@/lib/metas/periodo";

export const metadata: Metadata = { title: "Metas" };

const TRIMESTRE_LABEL: Record<string, string> = { Q1: "1º", Q2: "2º", Q3: "3º", Q4: "4º" };

function formatAnoTrimestre(anoTrimestre: string): string {
  const [ano, q] = anoTrimestre.split("-");
  return `${TRIMESTRE_LABEL[q!] ?? q} trimestre de ${ano}`;
}

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
  const anoTrimestrePadrao = trimestreDaData(agora);

  const escopos = await prisma.metaEscopo.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: {
      categorias: { select: { categoria: true }, orderBy: { categoria: "asc" } },
      periodos: {
        where: { anoTrimestre: { startsWith: `${ano}-` } },
        orderBy: { anoTrimestre: "asc" },
        include: {
          definidoPor: { select: { name: true } },
          eventos: { orderBy: { criadoEm: "desc" }, take: 1, include: { alteradoPor: { select: { name: true } } } },
        },
      },
    },
  });

  const podeEditar = user.role === "ADMIN";
  // Janela de 3 anos CENTRADA no ano visto agora (não no ano real) — clicar
  // ‹/› desliza a janela inteira pra frente/trás, sem limite. Um sistema
  // pensado pra durar anos não pode ter um teto de navegação fixo no código.
  const anosProximos = [ano - 1, ano, ano + 1];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Metas</h1>
        <p className="text-sm text-slate-500">
          Meta trimestral de receita por escopo, apurada por Data de Crédito da Cobrança — o mesmo critério do
          Panorama. Períodos maiores (semestre, ano) somam as metas dos trimestres que eles contêm.
        </p>
      </div>

      <Card>
        <SectionTitle>Definir meta</SectionTitle>
        <DefinirMetaForm
          escopos={escopos.map((e) => ({ slug: e.slug, nome: e.nome }))}
          anoTrimestrePadrao={anoTrimestrePadrao}
          podeEditar={podeEditar}
        />
      </Card>

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Ano:</span>
        <Link
          href={`/metas?ano=${ano - 1}`}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
          aria-label="Ano anterior"
        >
          ‹
        </Link>
        {anosProximos.map((a) => (
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
        <Link
          href={`/metas?ano=${ano + 1}`}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
          aria-label="Próximo ano"
        >
          ›
        </Link>
        {ano !== anoCorrente ? (
          <Link href="/metas" className="text-xs text-seahub-600 hover:underline">
            Ano atual
          </Link>
        ) : null}
      </div>

      {escopos.map((escopo) => (
        <Card key={escopo.id} className="overflow-x-auto">
          <SectionTitle hint={`${escopo.periodos.length} trimestre(s) com meta em ${ano}`}>{escopo.nome}</SectionTitle>

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
                São grafias diferentes (ou unidades diferentes) da mesma categoria — todas somam nesta meta.
              </span>
            ) : null}
          </p>

          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4">Trimestre</th>
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
                    <td className="py-2 pr-4 tabular-nums">{formatAnoTrimestre(p.anoTrimestre)}</td>
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
