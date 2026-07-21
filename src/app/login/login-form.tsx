"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/auth/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="card w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">skill-financeiro</h1>
        <p className="text-sm text-slate-500">Categorização de receita — Seahub Coworking</p>
      </div>

      <div>
        <label className="label" htmlFor="email">
          E-mail
        </label>
        <input className="input" id="email" name="email" type="email" required autoFocus />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Senha
        </label>
        <input className="input" id="password" name="password" type="password" required />
      </div>

      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

      <button className="btn w-full" type="submit" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
