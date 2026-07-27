import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { hasClickUpToken } from "@/lib/env";
import { Card, SectionTitle } from "@/components/ui";
import { NovoVinculoForm, EmpurrarAgoraButton } from "@/components/clickup-vinculo-form";
import { alternarVinculoAction } from "@/lib/clickup/actions";
import { listCategoriasConhecidas } from "@/lib/categorization/categorias";

export const metadata: Metadata = { title: "Integração ClickUp" };

function fmtDataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

export default async function ClickUpIntegracaoPage() {
  await requireRole("ADMIN");
  const [categorias, vinculos] = await Promise.all([
    listCategoriasConhecidas(),
    prisma.clickUpVinculo.findMany({
      orderBy: [{ ativo: "desc" }, { categoria: "asc" }],
      include: {
        criadoPor: { select: { name: true } },
        pushes: { orderBy: { enviadoEm: "desc" }, take: 1 },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Integração ClickUp</h1>
        <p className="text-sm text-slate-500">
          Alimenta os campos de mês (Janeiro..Dezembro) de tarefas do ClickUp com a receita já categorizada aqui — a
          cada sincronização, não só no fechamento do mês. Cada tarefa do ClickUp representa um PRODUTO (ex.
          "Endereço Fiscal Batial"), somando TODOS os clientes que usam aquele produto — nunca um cliente só. O
          ClickUp nunca é fonte de dado financeiro, só um espelho: uma falha aqui nunca interrompe uma sincronização
          de receita.
        </p>
      </div>

      {!hasClickUpToken() ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <p className="text-sm text-amber-800">
            <code>CLICKUP_API_TOKEN</code> não está configurado — os vínculos abaixo podem ser cadastrados, mas nenhum
            envio automático ou manual vai funcionar até a variável de ambiente ser definida.
          </p>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Novo vínculo</SectionTitle>
        <p className="mb-4 text-sm text-slate-500">
          Escolha a categoria e um ou mais padrões de texto que identificam o produto no "Serviço/Plano" da fatura
          (ex.: "Batial" para a tarefa "Endereço Fiscal Batial"). Use "Pré-visualizar" antes de vincular para conferir
          exatamente quais faturas e qual soma o padrão casa.
        </p>
        <NovoVinculoForm categorias={categorias} />
      </Card>

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${vinculos.length} vínculo(s)`}>Vínculos cadastrados</SectionTitle>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Padrões</th>
              <th className="pb-2 pr-4">Tarefa ClickUp</th>
              <th className="pb-2 pr-4">Último envio</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {vinculos.map((v) => {
              const ultimo = v.pushes[0];
              const padroes = v.padroes as string[];
              return (
                <tr key={v.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-4">{v.categoria}</td>
                  <td className="py-2 pr-4">
                    {padroes.map((p) => (
                      <code key={p} className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-xs">
                        {p}
                      </code>
                    ))}
                  </td>
                  <td className="py-2 pr-4">
                    <a
                      href={`https://app.clickup.com/t/${v.clickUpTaskId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-seahub-600 hover:underline"
                    >
                      {v.clickUpTaskId}
                    </a>
                    <span className="block text-xs text-slate-400">lista {v.clickUpListId}</span>
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {ultimo ? (
                      <>
                        <span className={ultimo.sucesso ? "text-emerald-700" : "text-red-600"}>
                          {ultimo.sucesso ? formatBRL(ultimo.valorEnviado.toString()) : "Falhou"}
                        </span>
                        <span className="block text-slate-400">
                          {ultimo.mes}/{ultimo.ano} · {fmtDataHora(ultimo.enviadoEm)}
                        </span>
                        {!ultimo.sucesso && ultimo.erro ? (
                          <span className="block max-w-xs truncate text-red-500" title={ultimo.erro}>
                            {ultimo.erro}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-400">nunca enviado</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{v.ativo ? "Sim" : "Não"}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-col items-start gap-2">
                      <EmpurrarAgoraButton vinculoId={v.id} />
                      <form action={alternarVinculoAction.bind(null, v.id, !v.ativo)}>
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit">
                          {v.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {vinculos.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Nenhum vínculo cadastrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
