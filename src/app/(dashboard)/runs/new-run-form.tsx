"use client";

import { useActionState } from "react";
import { triggerRunAction, type RunFormState } from "@/lib/categorization/actions";

const initialState: RunFormState = {};

export function NewRunForm({ jaEmAndamento = false }: { jaEmAndamento?: boolean }) {
  const [state, formAction, pending] = useActionState(triggerRunAction, initialState);
  const disabled = pending || jaEmAndamento;

  return (
    <form action={formAction} className="card space-y-4">
      <h2 className="font-semibold text-slate-900">Nova sincronização</h2>
      <p className="text-sm text-slate-500">
        Baixa Contas a Receber e Listar Vendas do Conexa (filtrados por Data de Crédito da Cobrança) e categoriza.
        Pode demorar alguns minutos dependendo do tamanho do período.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="periodoInicio">
            Data início
          </label>
          <input className="input" id="periodoInicio" name="periodoInicio" type="date" required disabled={jaEmAndamento} />
        </div>
        <div>
          <label className="label" htmlFor="periodoFim">
            Data fim
          </label>
          <input className="input" id="periodoFim" name="periodoFim" type="date" required disabled={jaEmAndamento} />
        </div>
        <button className="btn" type="submit" disabled={disabled}>
          {pending ? "Sincronizando..." : "Categorizar"}
        </button>
      </div>
      {jaEmAndamento ? (
        <p className="text-xs text-slate-400">Já existe uma sincronização em andamento — aguarde ela terminar.</p>
      ) : null}
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
