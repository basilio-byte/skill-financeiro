"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CategoriaField } from "@/components/categoria-field";
import {
  createCategoryRuleAction,
  triggerRunAction,
  type CategoryRuleState,
  type RunFormState,
} from "@/lib/categorization/actions";

/**
 * Formulário de cadastro de categoria COM RESPOSTA VISÍVEL.
 *
 * Antes era um `<form action={serverAction}>` puro, com a action retornando
 * void: salvava certo, mas a tela não mudava em nada. E não mudar era o
 * comportamento normal — cadastrar a regra grava em `RevenueCategoryRule`,
 * enquanto a lista de pendências lê `RevenueCategorizedLine`. Só uma
 * sincronização leva a regra de uma tabela para a outra, e a automática cobre
 * apenas o mês corrente, então pendência de mês passado ficava ali para sempre.
 * O usuário clicava, nada acontecia, e não havia nada na tela explicando isso.
 *
 * Agora a action devolve estado: confirma o que foi salvo e, quando existem
 * faturas antigas presas em "Sem Categoria", oferece re-sincronizar o período
 * exato que as contém.
 */

const estadoInicial: CategoryRuleState = {};

function BotaoSalvar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn disabled:opacity-60" type="submit" disabled={pending}>
      {pending ? "Salvando…" : children}
    </button>
  );
}

function BotaoAplicarAgora() {
  const { pending } = useFormStatus();
  return (
    <button className="btn mt-2 px-3 py-1.5 text-xs disabled:opacity-60" type="submit" disabled={pending}>
      {pending ? "Sincronizando…" : "Aplicar agora nas faturas já existentes"}
    </button>
  );
}

/**
 * Re-processa o período que contém as faturas presas em "Sem Categoria".
 *
 * Dispara a sincronização normal em vez de dar UPDATE direto nas linhas: uma
 * linha que muda de categoria pode precisar ser FUNDIDA com outra linha da
 * mesma fatura que já tem essa categoria (e o rateio proporcional refeito) —
 * o motor de categorização já faz isso corretamente, um UPDATE cru não faria.
 */
function br(ymd: string): string {
  return ymd.split("-").reverse().join("/");
}

/** Quantos meses o período abrange (inclusivo) — só para avisar quando for longo. */
function mesesNoPeriodo(inicio: string, fim: string): number {
  const [ai, mi] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  return (af! - ai!) * 12 + (mf! - mi!) + 1;
}

function AplicarAgora({ pendentes }: { pendentes: NonNullable<CategoryRuleState["pendentes"]> }) {
  const [state, action] = useActionState<RunFormState, FormData>(triggerRunAction, {});
  const mesmoDia = pendentes.inicio === pendentes.fim;
  const meses = mesesNoPeriodo(pendentes.inicio, pendentes.fim);

  return (
    <form action={action} className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs text-slate-700">
        <strong>{pendentes.linhas} fatura(s) já processadas</strong> continuam como "Sem Categoria" — a regra vale
        para sincronizações futuras, mas não altera sozinha o que já foi gravado.
        {mesmoDia ? ` Elas são de ${br(pendentes.inicio)}.` : ` Elas vão de ${br(pendentes.inicio)} a ${br(pendentes.fim)}.`}
      </p>
      {meses > 2 ? (
        <p className="mt-1 text-xs text-amber-800">
          Atenção: são {meses} meses de faturas. Reprocessar esse período inteiro busca tudo de novo no Conexa e pode
          demorar vários minutos — a sincronização continua rodando mesmo se você sair desta tela.
        </p>
      ) : null}
      <input type="hidden" name="periodoInicio" value={pendentes.inicio} />
      <input type="hidden" name="periodoFim" value={pendentes.fim} />
      <BotaoAplicarAgora />
      {state.error ? <p className="mt-1 text-xs text-red-600">{state.error}</p> : null}
    </form>
  );
}

function Mensagens({ state }: { state: CategoryRuleState }) {
  return (
    <>
      {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="mt-2 text-sm text-emerald-700">{state.ok}</p> : null}
      {state.pendentes ? <AplicarAgora pendentes={state.pendentes} /> : null}
    </>
  );
}

/** Form da pendência: o nome do serviço é fixo, só a categoria é escolhida. */
export function PendenciaForm({
  nome,
  categorias,
  campoId,
}: {
  nome: string;
  categorias: string[];
  campoId: string;
}) {
  const [state, action] = useActionState<CategoryRuleState, FormData>(createCategoryRuleAction, estadoInicial);

  return (
    <div className="mt-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="nome" value={nome} />
        <div className="min-w-[240px] flex-1">
          <CategoriaField categorias={categorias} id={campoId} label={`Categoria para "${nome}"`} />
        </div>
        <BotaoSalvar>Categorizar</BotaoSalvar>
      </form>
      <Mensagens state={state} />
    </div>
  );
}

/** Form "Nova categoria": nome do serviço digitado à mão, com antecedência. */
export function NovaRegraForm({ categorias }: { categorias: string[] }) {
  const [state, action] = useActionState<CategoryRuleState, FormData>(createCategoryRuleAction, estadoInicial);

  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="nome">
            Nome do serviço/plano
          </label>
          <input className="input" id="nome" name="nome" required />
        </div>
        <div className="min-w-[240px] flex-1">
          <CategoriaField categorias={categorias} id="categoria-nova" />
        </div>
        <BotaoSalvar>Adicionar</BotaoSalvar>
      </form>
      <Mensagens state={state} />
    </div>
  );
}
