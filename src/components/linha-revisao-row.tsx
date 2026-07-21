"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatBRL } from "@/lib/money";
import { updateCategorizedLineAction, type LineEditState } from "@/lib/categorization/actions";

export interface LinhaRevisao {
  id: string;
  crConexaId: number;
  razaoSocial: string | null;
  servicoOuPlano: string;
  categoria: string;
  proporcionado: string;
  valorRecebidoCat: string;
  revisadoManualmente: boolean;
  revisadoPorNome: string | null;
  revisadoEm: string | null;
  categoriaOriginal: string | null;
  valorRecebidoCatOriginal: string | null;
}

const PROPORCIONADO_LABEL: Record<string, string> = {
  N: "N",
  S: "S — rateado",
  SEM_LV: "Sem LV",
};

const initialState: LineEditState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn px-3 py-1.5 text-xs disabled:opacity-60">
      {pending ? "Salvando…" : "Salvar revisão"}
    </button>
  );
}

export function LinhaRevisaoRow({ linha }: { linha: LinhaRevisao }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<LineEditState, FormData>(updateCategorizedLineAction, initialState);

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="py-2 pr-4">{linha.crConexaId}</td>
        <td className="py-2 pr-4">{linha.razaoSocial}</td>
        <td className="py-2 pr-4 text-slate-600">{linha.servicoOuPlano}</td>
        <td className="py-2 pr-4">
          {linha.categoria}
          {linha.revisadoManualmente ? (
            <span className="ml-2 inline-flex rounded-full bg-seahub-100 px-2 py-0.5 text-[10px] font-medium text-seahub-800">
              revisado
            </span>
          ) : null}
        </td>
        <td className="py-2 pr-4">{PROPORCIONADO_LABEL[linha.proporcionado] ?? linha.proporcionado}</td>
        <td className="py-2 pr-4">{formatBRL(linha.valorRecebidoCat)}</td>
        <td className="py-2 pr-4">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary px-2 py-1 text-xs"
          >
            {editing ? "Cancelar" : "Editar"}
          </button>
        </td>
      </tr>
      {editing ? (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={7} className="px-3 py-3">
            <form action={action} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="lineId" value={linha.id} />
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Categoria
                <input name="categoria" defaultValue={linha.categoria} required className="input" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Valor recebido (categoria)
                <input
                  name="valor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={linha.valorRecebidoCat}
                  required
                  className="input"
                />
              </label>
              <SubmitButton />
              {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
              {state.ok ? <p className="text-sm text-emerald-600">{state.ok}</p> : null}
            </form>
            {linha.revisadoManualmente ? (
              <p className="mt-2 text-xs text-slate-500">
                Revisado por {linha.revisadoPorNome ?? "—"}
                {linha.revisadoEm ? ` em ${new Date(linha.revisadoEm).toLocaleString("pt-BR")}` : ""}.
                {linha.categoriaOriginal ? ` Categoria calculada pela skill: "${linha.categoriaOriginal}".` : ""}
                {linha.valorRecebidoCatOriginal ? ` Valor calculado pela skill: ${formatBRL(linha.valorRecebidoCatOriginal)}.` : ""}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
