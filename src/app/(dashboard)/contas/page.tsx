import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card, SectionTitle } from "@/components/ui";
import { CreateUserForm, UserRow, type UserRowData } from "@/components/contas-panel";

export const metadata: Metadata = { title: "Contas e acessos" };

export default async function ContasPage() {
  const admin = await requireRole("ADMIN");

  const [users, loginEvents] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] }),
    prisma.loginEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const rows: UserRowData[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Contas e acessos</h1>
        <p className="text-sm text-slate-500">
          Usuários internos, papéis e senhas. Administradores gerenciam categorias e disparam rodadas; visualizadores
          só consultam.
        </p>
      </div>

      <Card>
        <SectionTitle>Novo usuário</SectionTitle>
        <CreateUserForm />
      </Card>

      <Card>
        <SectionTitle hint={`${users.length} usuário(s)`}>Usuários</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2">Último acesso</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <UserRow key={u.id} user={u} currentUserId={admin.id} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Guardas ativas: o último administrador ativo não pode ser rebaixado, desativado nem excluído, e ninguém pode
          se trancar fora (rebaixar/desativar/excluir a própria conta).
        </p>
      </Card>

      <Card>
        <SectionTitle hint="20 mais recentes">Auditoria de acessos</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Resultado</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {loginEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-400">
                    Sem eventos de acesso ainda.
                  </td>
                </tr>
              ) : (
                loginEvents.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{e.createdAt.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-slate-700">{e.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${e.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}
                      >
                        {e.success ? "sucesso" : "falha"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{e.reason ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{e.ip ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
