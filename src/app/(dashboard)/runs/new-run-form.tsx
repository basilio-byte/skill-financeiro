"use client";

import { useActionState } from "react";
import { triggerRunAction, type RunFormState } from "@/lib/categorization/actions";

const initialState: RunFormState = {};

export function NewRunForm() {
  const [state, formAction, pending] = useActionState(triggerRunAction, initialState);

  return (
    <form action={formAction} className="card space-y-4">
      <h2 className="font-semibold text-slate-900">Nova rodada</h2>
      <p className="text-sm text-slate-500">
        Baixa Contas a Receber e Listar Vendas do Conexa (filtrados por Data de Crédito da Cobrança) e categoriza.
        Pode demorar alguns minutos dependendo do tamanho do período.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="periodoInicio">
            Data início
          </label>
          <input className="input" id="periodoInicio" name="periodoInicio" type="date" required />
        </div>
        <div>
          <label className="label" htmlFor="periodoFim">
            Data fim
          </label>
          <input className="input" id="periodoFim" name="periodoFim" type="date" required />
        </div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Rodando..." : "Categorizar"}
        </button>
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
