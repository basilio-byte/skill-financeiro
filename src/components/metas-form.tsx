"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { definirMetaAction, removerMetaAction, type MetaFormState } from "@/lib/metas/actions";

const inicial: MetaFormState = {};

const TRIMESTRES = [
  { valor: "Q1", label: "1º trimestre (jan-mar)" },
  { valor: "Q2", label: "2º trimestre (abr-jun)" },
  { valor: "Q3", label: "3º trimestre (jul-set)" },
  { valor: "Q4", label: "4º trimestre (out-dez)" },
];

const MESES = [
  { valor: "01", label: "Janeiro" },
  { valor: "02", label: "Fevereiro" },
  { valor: "03", label: "Março" },
  { valor: "04", label: "Abril" },
  { valor: "05", label: "Maio" },
  { valor: "06", label: "Junho" },
  { valor: "07", label: "Julho" },
  { valor: "08", label: "Agosto" },
  { valor: "09", label: "Setembro" },
  { valor: "10", label: "Outubro" },
  { valor: "11", label: "Novembro" },
  { valor: "12", label: "Dezembro" },
];

function Botao({ children, secundario }: { children: React.ReactNode; secundario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${secundario ? "btn-secondary" : "btn"} disabled:opacity-60`}
    >
      {pending ? "Salvando…" : children}
    </button>
  );
}

export function DefinirMetaForm({
  escopos,
  anoTrimestrePadrao,
  anoMesPadrao,
  podeEditar,
}: {
  escopos: Array<{ slug: string; nome: string }>;
  /** "yyyy-Q#" do trimestre corrente — só o valor inicial dos selects trimestrais. */
  anoTrimestrePadrao: string;
  /** "yyyy-MM" do mês corrente — só o valor inicial dos selects mensais. */
  anoMesPadrao: string;
  podeEditar: boolean;
}) {
  const [state, action] = useActionState<MetaFormState, FormData>(definirMetaAction, inicial);
  // Mensal e trimestral são séries independentes (ver metas.ts) — o form só
  // mostra os campos da granularidade escolhida por vez, nunca os dois juntos,
  // pra não sugerir que dá pra preencher "a mesma meta" nos dois formatos.
  const [granularidade, setGranularidade] = useState<"MES" | "TRIMESTRE">("TRIMESTRE");

  const [anoTrimPadrao, trimestrePadrao] = anoTrimestrePadrao.split("-Q");
  const [anoMesPadraoAno, mesPadrao] = anoMesPadrao.split("-");
  const anoPadrao = granularidade === "MES" ? anoMesPadraoAno : anoTrimPadrao;
  const anos = [Number(anoPadrao) - 1, Number(anoPadrao), Number(anoPadrao) + 1];

  if (!podeEditar) {
    return (
      <p className="text-sm text-slate-500">
        Somente administradores podem definir metas. Os valores já definidos aparecem abaixo.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Granularidade da meta">
        {(["TRIMESTRE", "MES"] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={granularidade === g}
            onClick={() => setGranularidade(g)}
            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
              granularidade === g ? "bg-seahub-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {g === "MES" ? "Mensal" : "Trimestral"}
          </button>
        ))}
      </div>

      <form key={granularidade} action={action} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="granularidade" value={granularidade} />

        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="escopoSlug">
            Escopo
          </label>
          <select className="input" id="escopoSlug" name="escopoSlug" required defaultValue="">
            <option value="" disabled>
              Selecione…
            </option>
            {escopos.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[110px]">
          <label className="label" htmlFor="metaAno">
            Ano
          </label>
          <select className="input" id="metaAno" name="metaAno" defaultValue={anoPadrao} required>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {granularidade === "MES" ? (
          <div className="min-w-[160px]">
            <label className="label" htmlFor="metaMes">
              Mês
            </label>
            <select className="input" id="metaMes" name="metaMes" defaultValue={mesPadrao} required>
              {MESES.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="min-w-[190px]">
            <label className="label" htmlFor="metaTrimestre">
              Trimestre
            </label>
            <select className="input" id="metaTrimestre" name="metaTrimestre" defaultValue={trimestrePadrao} required>
              {TRIMESTRES.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="min-w-[170px]">
          <label className="label" htmlFor="valor">
            Meta (R$)
          </label>
          {/* Numérico de propósito: um campo de texto aceitaria "25.000", que um
              parser pt-BR leria como vinte e cinco reais, sem erro nenhum. */}
          <input
            className="input"
            id="valor"
            name="valor"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="75000.00"
            required
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="repetirAteFimDoAno" className="h-4 w-4 rounded border-slate-300" />
          Repetir para os {granularidade === "MES" ? "meses" : "trimestres"} seguintes do ano
        </label>

        <Botao>Salvar meta</Botao>
      </form>

      {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="mt-2 text-sm text-emerald-700">{state.ok}</p> : null}
    </div>
  );
}

export function RemoverMetaForm({ metaPeriodoId }: { metaPeriodoId: string }) {
  const [state, action] = useActionState<MetaFormState, FormData>(removerMetaAction, inicial);
  return (
    <form action={action}>
      <input type="hidden" name="metaPeriodoId" value={metaPeriodoId} />
      <Botao secundario>Remover</Botao>
      {state.error ? <span className="ml-2 text-xs text-red-600">{state.error}</span> : null}
    </form>
  );
}
