"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordChangeState } from "@/lib/auth/actions";

const initialState: PasswordChangeState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="card max-w-md space-y-4">
      <h2 className="font-semibold text-slate-900">Trocar senha</h2>
      <div>
        <label className="label" htmlFor="currentPassword">
          Senha atual
        </label>
        <input className="input" id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div>
        <label className="label" htmlFor="newPassword">
          Nova senha
        </label>
        <input className="input" id="newPassword" name="newPassword" type="password" required minLength={10} />
      </div>
      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirmar nova senha
        </label>
        <input className="input" id="confirmPassword" name="confirmPassword" type="password" required minLength={10} />
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-600">Senha atualizada.</p> : null}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
