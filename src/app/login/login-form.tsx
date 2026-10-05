"use client";

import { useActionState } from "react";
import { IconAlerta } from "@/components/icons";
import { loginAction, type LoginState } from "@/lib/auth/actions";
import { Assinatura } from "@/components/logo";

const initialState: LoginState = {};

/**
 * Login em duas colunas, no mesmo desenho do dash comercial: painel de marca à esquerda e formulário à
 * direita. Só APRESENTAÇÃO — a ação (`loginAction`), os nomes dos campos (`email`, `password`) e o
 * tratamento de erro são exatamente os de antes.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen">
      {/* Painel de marca. Some abaixo de `lg`: no celular o formulário ocupa a tela inteira. */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-marca p-12 lg:flex">
        {/* Brilho suave de fundo: dá volume ao painel sem virar decoração barulhenta. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 -top-28 h-[26rem] w-[26rem] rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "var(--marca-brilho)" }}
        />
        {/* O monograma real da marca como marca-d'água (6% de opacidade). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/seahub-monograma.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-20 h-[30rem] w-[30rem] select-none opacity-[0.06]"
        />

        <div className="relative">
          <Assinatura altura={34} />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.028em] text-[var(--marca-tinta)]">
            A receita do mês,
            <br />
            por data de crédito.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--marca-tinta-2)]">
            Categorizada a partir do Conexa e pronta para o fechamento.
          </p>
        </div>

        <p className="relative text-[13px] text-[var(--marca-tinta-3)]">Uso interno · Seahub Coworking</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form action={formAction} className="w-full max-w-[340px]">
          {/* Sem o painel de marca (celular), a assinatura vai para cima do formulário, sobre um bloco da cor da marca. */}
          <div className="mb-7 inline-flex rounded-lg bg-marca px-3.5 py-3 lg:hidden">
            <Assinatura altura={22} />
          </div>

          <h1 className="text-[24px] font-semibold tracking-[-0.022em]">Entrar</h1>
          <p className="mt-1.5 text-[14px] text-slate-500">Acesso restrito ao time interno.</p>

          <div className="mt-6 space-y-3.5">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input
                className="input !py-2.5 !text-[15px]"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Senha
              </label>
              <input
                className="input !py-2.5 !text-[15px]"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            {state.error ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[14px] text-red-700"
              >
                <IconAlerta size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">{state.error}</div>
              </div>
            ) : null}

            <button className="btn w-full !py-2.5" type="submit" disabled={pending}>
              {pending ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
