import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import { createCategoryRuleAction, toggleCategoryRuleAction } from "@/lib/categorization/actions";

export const metadata: Metadata = { title: "Categorias" };

const SEM_CATEGORIA = "Sem Categoria";

interface Pendencia {
  nome: string;
  ocorrencias: number;
  total: string;
  amostras: Array<{ razaoSocial: string | null; crConexaId: number; valorRecebidoCat: string; competencia: Date | null }>;
}

async function buildPendencias(): Promise<Pendencia[]> {
  const agg = await prisma.revenueCategorizedLine.groupBy({
    by: ["servicoOuPlano"],
    // servicoOuPlano vazio não é acionável (não dá pra cadastrar regra pra "nada") — só
    // acontece em linhas de antes deste campo existir (default de migration).
    where: { categoria: SEM_CATEGORIA, servicoOuPlano: { not: "" } },
    _count: { _all: true },
    _sum: { valorRecebidoCat: true },
    orderBy: { _sum: { valorRecebidoCat: "desc" } },
    take: 50,
  });
  if (agg.length === 0) return [];

  const amostras = await prisma.revenueCategorizedLine.findMany({
    where: { categoria: SEM_CATEGORIA, servicoOuPlano: { in: agg.map((a) => a.servicoOuPlano) } },
    orderBy: { id: "desc" },
    select: { servicoOuPlano: true, razaoSocial: true, crConexaId: true, valorRecebidoCat: true, competencia: true },
    take: 1000,
  });
  const amostrasPorNome = new Map<string, Pendencia["amostras"]>();
  for (const a of amostras) {
    const arr = amostrasPorNome.get(a.servicoOuPlano) ?? [];
    if (arr.length < 3) {
      arr.push({
        razaoSocial: a.razaoSocial,
        crConexaId: a.crConexaId,
        valorRecebidoCat: a.valorRecebidoCat.toString(),
        competencia: a.competencia,
      });
    }
    amostrasPorNome.set(a.servicoOuPlano, arr);
  }

  return agg.map((a) => ({
    nome: a.servicoOuPlano,
    ocorrencias: a._count._all,
    total: (a._sum.valorRecebidoCat ?? 0).toString(),
    amostras: amostrasPorNome.get(a.servicoOuPlano) ?? [],
  }));
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export default async function CategoriasPage() {
  const [regras, pendencias] = await Promise.all([
    prisma.revenueCategoryRule.findMany({ orderBy: { nome: "asc" } }),
    buildPendencias(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Categorias</h1>
        <p className="text-sm text-slate-500">
          Tabela de categorização (nome do serviço/plano → categoria) usada em toda rodada nova.
        </p>
      </div>

      {pendencias.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <SectionTitle hint={`${pendencias.length} serviço(s)/plano(s) distinto(s)`}>
            Pendências de categorização — "Sem Categoria"
          </SectionTitle>
          <p className="mb-4 text-sm text-slate-600">
            Estes nomes não bateram com nenhuma regra em sincronizações já processadas. Cadastre a categoria correta
            abaixo — a próxima sincronização que encontrar o mesmo nome já vem categorizada.
          </p>
          <ul className="flex flex-col gap-4">
            {pendencias.map((p) => (
              <li key={p.nome} className="rounded-lg border border-amber-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{p.nome}</p>
                    <p className="text-xs text-slate-500">
                      {p.ocorrencias} ocorrência(s) · {formatBRL(p.total)} no total
                    </p>
                  </div>
                </div>

                {p.amostras.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-500">
                      <thead>
                        <tr>
                          <th className="pr-3 py-1">CR ID</th>
                          <th className="pr-3 py-1">Cliente</th>
                          <th className="pr-3 py-1">Competência</th>
                          <th className="pr-3 py-1">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.amostras.map((a, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="pr-3 py-1">{a.crConexaId}</td>
                            <td className="pr-3 py-1">{a.razaoSocial || "—"}</td>
                            <td className="pr-3 py-1">{fmtDate(a.competencia)}</td>
                            <td className="pr-3 py-1">{formatBRL(a.valorRecebidoCat)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <form action={createCategoryRuleAction} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="nome" value={p.nome} />
                  <div className="min-w-[240px] flex-1">
                    <label className="label" htmlFor={`categoria-${p.nome}`}>
                      Categoria para "{p.nome}"
                    </label>
                    <input className="input" id={`categoria-${p.nome}`} name="categoria" required />
                  </div>
                  <button className="btn" type="submit">
                    Categorizar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Nova categoria</SectionTitle>
        <p className="mb-4 text-sm text-slate-500">
          Nome deve bater exatamente com o "Serviço/Item" (Listar Vendas) ou "Plano Contratado" (Contas a Receber) no
          Conexa. Serviços novos que ainda não apareceram nas sincronizações também podem ser cadastrados aqui, com
          antecedência.
        </p>
        <form action={createCategoryRuleAction} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="label" htmlFor="nome">
              Nome do serviço/plano
            </label>
            <input className="input" id="nome" name="nome" required />
          </div>
          <div className="min-w-[240px] flex-1">
            <label className="label" htmlFor="categoria">
              Categoria
            </label>
            <input className="input" id="categoria" name="categoria" required />
          </div>
          <button className="btn" type="submit">
            Adicionar
          </button>
        </form>
      </Card>

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${regras.length} regra(s)`}>Tabela de categorização</SectionTitle>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {regras.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-2 pr-4">{r.nome}</td>
                <td className="py-2 pr-4">{r.categoria}</td>
                <td className="py-2 pr-4">{r.ativo ? "Sim" : "Não"}</td>
                <td className="py-2 pr-4">
                  <form action={toggleCategoryRuleAction.bind(null, r.id, !r.ativo)}>
                    <button className="btn-secondary" type="submit">
                      {r.ativo ? "Desativar" : "Ativar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {regras.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">
                  Nenhuma categoria cadastrada — rode <code>npm run db:seed-categories</code>.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
