"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  changeMyPasswordAction,
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  updateUserAction,
  type UserActionState,
} from "@/lib/auth/user-actions";

export interface UserRowData {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "VIEWER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-seahub-500 focus:ring-2 focus:ring-seahub-200";

function SubmitButton({
  children,
  variant = "secondary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  const style =
    variant === "primary"
      ? "bg-seahub-600 text-white hover:bg-seahub-700"
      : variant === "danger"
        ? "border border-red-300 text-red-700 hover:bg-red-50"
        : "border border-slate-300 text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${style}`}
    >
      {pending ? "Salvando…" : children}
    </button>
  );
}

/** Mostra o resultado (erro em vermelho, sucesso em verde) de um useActionState. */
function Feedback({ state }: { state: UserActionState }) {
  if (state.error) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{state.ok}</p>;
  return null;
}

// ---------------------------------------------------------------------------
// Criar usuário
// ---------------------------------------------------------------------------
export function CreateUserForm() {
  const [state, action] = useActionState<UserActionState, FormData>(createUserAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Nome
          <input name="name" required className={input} placeholder="Nome completo" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          E-mail
          <input
            name="email"
            type="email"
            required
            className={input}
            placeholder="voce@seahubcoworking.com.br"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Papel
          <select name="role" defaultValue="VIEWER" className={input}>
            <option value="VIEWER">Visualizador (só relatórios)</option>
            <option value="ADMIN">Administrador (tudo)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Senha inicial
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className={input}
            placeholder="mín. 8 caracteres"
            autoComplete="new-password"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="primary">Criar usuário</SubmitButton>
        <Feedback state={state} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Linha de usuário com ações (editar / resetar senha / excluir)
// ---------------------------------------------------------------------------
function fmtDate(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR");
}

export function UserRow({ user, currentUserId }: { user: UserRowData; currentUserId: string }) {
  const [panel, setPanel] = useState<"none" | "edit" | "password" | "delete">("none");
  const isSelf = user.id === currentUserId;

  const [editState, editAction] = useActionState<UserActionState, FormData>(updateUserAction, {});
  const [pwState, pwAction] = useActionState<UserActionState, FormData>(resetPasswordAction, {});
  const [delState, delAction] = useActionState<UserActionState, FormData>(deleteUserAction, {});

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2">
          <p className="font-medium text-slate-800">
            {user.name} {isSelf ? <span className="text-xs font-normal text-slate-400">(você)</span> : null}
          </p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${user.role === "ADMIN" ? "bg-seahub-100 text-seahub-800" : "bg-slate-100 text-slate-600"}`}
          >
            {user.role === "ADMIN" ? "Administrador" : "Visualizador"}
          </span>
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${user.isActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}
          >
            {user.isActive ? "Ativo" : "Inativo"}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(user.lastLoginAt)}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPanel(panel === "edit" ? "none" : "edit")}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Editar
            </button>
            <button
              onClick={() => setPanel(panel === "password" ? "none" : "password")}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Resetar senha
            </button>
            <button
              onClick={() => setPanel(panel === "delete" ? "none" : "delete")}
              className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Excluir
            </button>
          </div>
        </td>
      </tr>
      {panel !== "none" ? (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={5} className="px-3 py-3">
            {panel === "edit" ? (
              <form action={editAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Nome
                  <input name="name" defaultValue={user.name} required className={input} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Papel
                  <select
                    name="role"
                    defaultValue={user.role}
                    className={input}
                    disabled={isSelf}
                    title={isSelf ? "Você não pode alterar o próprio papel" : undefined}
                  >
                    <option value="VIEWER">Visualizador</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                  {isSelf ? <input type="hidden" name="role" value={user.role} /> : null}
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Situação
                  <select
                    name="isActive"
                    defaultValue={String(user.isActive)}
                    className={input}
                    disabled={isSelf}
                    title={isSelf ? "Você não pode desativar a própria conta" : undefined}
                  >
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                  {isSelf ? <input type="hidden" name="isActive" value={String(user.isActive)} /> : null}
                </label>
                <SubmitButton variant="primary">Salvar</SubmitButton>
                <Feedback state={editState} />
              </form>
            ) : null}

            {panel === "password" ? (
              <form action={pwAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Nova senha para {user.email}
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    className={input}
                    placeholder="mín. 8 caracteres"
                    autoComplete="new-password"
                  />
                </label>
                <SubmitButton>Redefinir senha</SubmitButton>
                <Feedback state={pwState} />
                <p className="w-full text-xs text-slate-500">Ao redefinir, as sessões abertas desse usuário são encerradas.</p>
              </form>
            ) : null}

            {panel === "delete" ? (
              <form action={delAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <p className="text-sm text-slate-700">
                  Excluir <strong>{user.email}</strong> definitivamente? A auditoria de acessos é preservada.
                </p>
                <SubmitButton variant="danger">Confirmar exclusão</SubmitButton>
                <button type="button" onClick={() => setPanel("none")} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">
                  Cancelar
                </button>
                <Feedback state={delState} />
              </form>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Trocar a própria senha (/minha-conta)
// ---------------------------------------------------------------------------
export function ChangePasswordForm() {
  const [state, action] = useActionState<UserActionState, FormData>(changeMyPasswordAction, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Senha atual
        <input name="current" type="password" required className={input} autoComplete="current-password" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Nova senha
        <input name="next" type="password" required minLength={8} className={input} placeholder="mín. 8 caracteres" autoComplete="new-password" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Confirmar nova senha
        <input name="confirm" type="password" required minLength={8} className={input} autoComplete="new-password" />
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton variant="primary">Alterar senha</SubmitButton>
        <Feedback state={state} />
      </div>
    </form>
  );
}
