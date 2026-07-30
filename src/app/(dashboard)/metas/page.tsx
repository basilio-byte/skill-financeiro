import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { DefinirMetaForm, RemoverMetaForm } from "@/components/metas-form";
import { nowInAppTz } from "@/lib/dates";
import { trimestreDaData, mesDaData } from "@/lib/metas/periodo";

export const metadata: Metadata = { title: "Metas" };

const TRIMESTRE_LABEL: Record<string, string> = { Q1: "1º", Q2: "2º", Q3: "3º", Q4: "4º" };
const MES_LABEL: Record<string, string> = {
  "01": "Janeiro",
  "02": "Fevereiro",
  "03": "Março",
  "04": "Abril",
  "05": "Maio",
  "06": "Junho",
  "07": "Julho",
  "08": "Agosto",
  "09": "Setembro",
  "10": "Outubro",
  "11": "Novembro",
  "12": "Dezembro",
};

/** "yyyy-Q#" -> "3º trimestre de 2026"; "yyyy-MM" -> "Julho de 2026". */
function formatPeriodoChave(granularidade: "MES" | "TRIMESTRE", periodoChave: string): string {
  const [ano, sub] = periodoChave.split("-");
  if (granularidade === "MES") return `${MES_LABEL[sub!] ?? sub} de ${ano}`;
  return `${TRIMESTRE_LABEL[sub!] ?? sub} trimestre de ${ano}`;
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
  // O padrão do formulário "Definir meta" segue o ANO QUE ESTÁ SENDO VISTO
  // (não o ano real de hoje) — mesmo motivo da janela de navegação abaixo:
  // um admin navegando pra 2028 e abrindo o formulário esperava poder
  // escolher 2028 direto, não ficar preso a um seletor sempre ancorado em
  // hoje. O trimestre/mês-padrão só reflete o valor real quando o ano visto
  // é o ano corrente; para qualquer outro ano não existe "período atual",
  // então cai em Q1 / Janeiro.
  const trimestreNumeroPadrao = ano === anoCorrente ? trimestreDaData(agora).split("-Q")[1] : "1";
  const anoTrimestrePadrao = `${ano}-Q${trimestreNumeroPadrao}`;
  const mesNumeroPadrao = ano === anoCorrente ? mesDaData(agora).split("-")[1] : "01";
  const anoMesPadrao = `${ano}-${mesNumeroPadrao}`;

  const escopos = await prisma.metaEscopo.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: {
      categorias: { select: { categoria: true }, orderBy: { categoria: "asc" } },
      periodos: {
        where: { periodoChave: { startsWith: `${ano}-` } },
        orderBy: [{ granularidade: "asc" }, { periodoChave: "asc" }],
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
          Meta de receita por escopo, mensal e trimestral — as duas são séries independentes, cada uma definida
          direto (uma não é calculada a partir da outra). Apuração por Data de Crédito da Cobrança — o mesmo
          critério do Panorama. Semestre e ano somam as metas dos trimestres que eles contêm.
        </p>
      </div>

      <Card>
        <SectionTitle>Definir meta</SectionTitle>
        <DefinirMetaForm
          escopos={escopos.map((e) => ({ slug: e.slug, nome: e.nome }))}
          anoTrimestrePadrao={anoTrimestrePadrao}
          anoMesPadrao={anoMesPadrao}
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

      {escopos.map((escopo) => {
        const periodosMensais = escopo.periodos.filter((p) => p.granularidade === "MES");
        const periodosTrimestrais = escopo.periodos.filter((p) => p.granularidade === "TRIMESTRE");
        return (
          <Card key={escopo.id} className="overflow-x-auto">
            <SectionTitle
              hint={`${periodosTrimestrais.length} trimestre(s) e ${periodosMensais.length} mês(es) com meta em ${ano}`}
            >
              {escopo.nome}
            </SectionTitle>

            {escopo.todasCategorias ? (
              <p className="mb-3 text-xs text-slate-500">
                Soma <strong>toda a receita do período</strong>, sem filtrar categoria — é o mesmo número do
                &quot;Total recebido no período&quot; do Panorama. Categoria nova criada em{" "}
                <Link href="/categorias" className="text-seahub-600 hover:underline">
                  Categorias
                </Link>{" "}
                já entra aqui sozinha.
                <span className="block pt-1 text-slate-400">
                  Atenção: este escopo se sobrepõe aos outros (a receita dele inclui a deles), então não somar as
                  metas de todos — daria dinheiro contado duas vezes.
                </span>
              </p>
            ) : (
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
            )}

            {(
              [
                { titulo: "Trimestral", periodos: periodosTrimestrais },
                { titulo: "Mensal", periodos: periodosMensais },
              ] as const
            ).map(({ titulo, periodos }) => (
              <div key={titulo} className="mb-4 last:mb-0">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{titulo}</h3>
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="pb-2 pr-4">Período</th>
                      <th className="pb-2 pr-4">Meta</th>
                      <th className="pb-2 pr-4">Definida por</th>
                      <th className="pb-2 pr-4">Última alteração</th>
                      {podeEditar ? <th className="pb-2 pr-4" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {periodos.map((p) => {
                      const ultimo = p.eventos[0];
                      const foiAlterada = ultimo?.valorAnterior != null;
                      return (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4 tabular-nums">
                            {formatPeriodoChave(p.granularidade, p.periodoChave)}
                          </td>
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
                    {periodos.length === 0 ? (
                      <tr>
                        <td colSpan={podeEditar ? 5 : 4} className="py-4 text-center text-slate-400">
                          Nenhuma meta {titulo.toLowerCase()} definida para {ano}.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ))}
          </Card>
        );
      })}

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
