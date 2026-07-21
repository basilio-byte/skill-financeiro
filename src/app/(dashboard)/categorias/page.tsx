import { prisma } from "@/lib/db";
import { createCategoryRuleAction, toggleCategoryRuleAction } from "@/lib/categorization/actions";

export default async function CategoriasPage() {
  const regras = await prisma.revenueCategoryRule.findMany({ orderBy: { nome: "asc" } });

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="mb-1 font-semibold text-slate-900">Nova categoria</h1>
        <p className="mb-4 text-sm text-slate-500">
          Nome deve bater exatamente com o "Serviço/Item" (Listar Vendas) ou "Plano Contratado" (Contas a Receber) no
          Conexa. Serviços novos que ainda não apareceram nas rodadas devem ser adicionados aqui.
        </p>
        <form action={createCategoryRuleAction} className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label className="label" htmlFor="nome">
              Nome do serviço/plano
            </label>
            <input className="input" id="nome" name="nome" required />
          </div>
          <div className="flex-1 min-w-[240px]">
            <label className="label" htmlFor="categoria">
              Categoria
            </label>
            <input className="input" id="categoria" name="categoria" required />
          </div>
          <button className="btn" type="submit">
            Adicionar
          </button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-4 font-semibold text-slate-900">Tabela de categorização ({regras.length})</h2>
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
      </div>
    </div>
  );
}
