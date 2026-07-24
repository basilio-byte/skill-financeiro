"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatBRL } from "@/lib/money";
import {
  resolverAutomaticamenteAction,
  excluirLinhaConflitoAction,
  type ConflitoActionState,
} from "@/lib/categorization/conflitos-actions";
import type { FaturaConflito } from "@/lib/categorization/conflitos";

const initialState: ConflitoActionState = {};

function BotaoResolver({ crConexaId }: { crConexaId: number }) {
  const [state, action] = useActionState<ConflitoActionState, FormData>(resolverAutomaticamenteAction, initialState);
  const { pending } = useFormStatus();
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="crConexaId" value={crConexaId} />
      <button type="submit" disabled={pending} className="btn px-3 py-1.5 text-xs disabled:opacity-60">
        {pending ? "Resolvendo…" : "Resolver automaticamente"}
      </button>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-xs text-emerald-600">{state.ok}</p> : null}
    </form>
  );
}

function BotaoExcluirLinha({ lineId }: { lineId: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [state, action] = useActionState<ConflitoActionState, FormData>(excluirLinhaConflitoAction, initialState);

  if (!confirmando) {
    return (
      <button type="button" onClick={() => setConfirmando(true)} className="btn-secondary px-2 py-1 text-xs">
        Excluir esta linha
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-700">Confirma excluir esta linha? Não tem como desfazer.</span>
        <SubmitConfirmar />
        <button type="button" onClick={() => setConfirmando(false)} className="btn-secondary px-2 py-1 text-xs">
          Cancelar
        </button>
      </div>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-xs text-emerald-600">{state.ok}</p> : null}
    </form>
  );
}

function SubmitConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn px-2 py-1 text-xs disabled:opacity-60">
      {pending ? "Excluindo…" : "Sim, excluir"}
    </button>
  );
}

export function ConflitoCard({ fatura }: { fatura: FaturaConflito }) {
  const { classificacao } = fatura;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">
            Fatura CR {fatura.crConexaId} — {fatura.razaoSocial ?? "(sem nome)"}
          </p>
          <p className="text-xs text-slate-500">
            Valor real da fatura: {formatBRL(fatura.valorRecebidoTotal)} · Soma atual das linhas:{" "}
            {formatBRL(fatura.somaAtual)} ·{" "}
            <span className="font-medium text-amber-700">Excesso: {formatBRL(fatura.diferenca)}</span>
          </p>
        </div>
        {classificacao.tipo !== "ambiguo" ? <BotaoResolver crConexaId={fatura.crConexaId} /> : null}
      </div>

      <p className="mt-2 text-xs text-slate-600">{classificacao.explicacao}</p>

      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-3">Categoria</th>
            <th className="py-1 pr-3">Valor</th>
            <th className="py-1 pr-3">Chave</th>
            <th className="py-1 pr-3">Serviço/Plano</th>
            <th className="py-1 pr-3">Origem</th>
            <th className="py-1 pr-3" />
          </tr>
        </thead>
        <tbody>
          {fatura.linhas.map((l) => (
            <tr key={l.id} className="border-t border-amber-100">
              <td className="py-1 pr-3">{l.categoria}</td>
              <td className="py-1 pr-3">{formatBRL(l.valorRecebidoCat)}</td>
              <td className="py-1 pr-3 text-slate-400">{l.chaveLinha}</td>
              <td className="py-1 pr-3 text-slate-600">{l.servicoOuPlano}</td>
              <td className="py-1 pr-3">
                {l.revisadoManualmente ? (
                  <span className="inline-flex flex-col">
                    <span className="inline-flex w-fit rounded-full bg-seahub-100 px-2 py-0.5 text-[10px] font-medium text-seahub-800">
                      manual — {l.revisadoPorNome ?? "—"}
                    </span>
                    {l.categoriaOriginal ? (
                      <span className="mt-0.5 text-[10px] text-slate-400">
                        skill original: &quot;{l.categoriaOriginal}&quot;
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-slate-400">automática</span>
                )}
              </td>
              <td className="py-1 pr-3">
                {classificacao.tipo === "ambiguo" ? <BotaoExcluirLinha lineId={l.id} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
