"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CategoriaField } from "@/components/categoria-field";
import { formatBRL } from "@/lib/money";
import {
  criarVinculoAction,
  empurrarAgoraAction,
  previsualizarVinculoAction,
  type PreviewState,
  type PushAgoraState,
  type VinculoFormState,
} from "@/lib/clickup/actions";

const estadoInicialVinculo: VinculoFormState = {};
const estadoInicialPush: PushAgoraState = {};
const estadoInicialPreview: PreviewState = {};

function BotaoSalvar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn disabled:opacity-60" type="submit" disabled={pending}>
      {pending ? "Salvando…" : children}
    </button>
  );
}

function TabelaPreview({ preview }: { preview: PreviewState }) {
  if (preview.error) return <p className="mt-2 text-sm text-red-600">{preview.error}</p>;
  if (!preview.itens) return null;

  if (preview.itens.length === 0) {
    return (
      <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
        Nenhuma fatura já categorizada bate com essa categoria + padrões. Confira a grafia antes de vincular.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-xs text-slate-500">
        Isto é o que vai ser somado — confira se bate com o que você espera antes de vincular:
      </p>
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1 pr-3">Serviço/Plano (Conexa)</th>
            <th className="pb-1 pr-3">Ocorrências</th>
            <th className="pb-1 pr-3">Clientes distintos</th>
            <th className="pb-1 pr-3">Total histórico</th>
          </tr>
        </thead>
        <tbody>
          {preview.itens.map((it) => (
            <tr key={it.servicoOuPlano} className="border-t border-slate-100">
              <td className="py-1 pr-3">{it.servicoOuPlano}</td>
              <td className="py-1 pr-3">{it.ocorrencias}</td>
              <td className="py-1 pr-3">{it.clientesDistintos}</td>
              <td className="py-1 pr-3">{formatBRL(it.totalHistorico)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm font-medium text-slate-800">
        Total do mês corrente (o que seria empurrado agora): {formatBRL(preview.totalMesCorrente ?? "0")}
      </p>
    </div>
  );
}

/**
 * Cadastro de vínculo categoria + padrões (contra `servicoOuPlano`) -> tarefa
 * do ClickUp. Um vínculo NUNCA aponta pra um cliente específico — soma todos
 * os clientes cujo Serviço/Plano contém algum dos padrões (achado real
 * 2026-07-27: cada tarefa do ClickUp representa um produto/variante, não um
 * cliente).
 *
 * "Pré-visualizar" é um botão `type="button"` comum (chama a Server Action
 * direto, sem passar por `<form action>`) — nunca um `formAction` no mesmo
 * `<form>` do "Vincular". Achado real (usuário testou e reportou): depois que
 * uma Server Action ligada a um `<form>`/`formAction` termina, o React reseta
 * os campos não controlados do formulário (mesmo comportamento de um form
 * nativo pós-submit) — como os dois botões dividiam o mesmo form, a prévia
 * apagava tudo antes do "Vincular" poder usar os mesmos valores.
 */
export function NovoVinculoForm({ categorias }: { categorias: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(estadoInicialPreview);
  const [previewPending, startPreviewTransition] = useTransition();
  const [vinculoState, vinculoAction] = useActionState<VinculoFormState, FormData>(criarVinculoAction, estadoInicialVinculo);

  function handlePreVisualizar() {
    if (!formRef.current) return;
    const dados = new FormData(formRef.current);
    startPreviewTransition(async () => {
      setPreviewState(await previsualizarVinculoAction(estadoInicialPreview, dados));
    });
  }

  return (
    <div>
      <form ref={formRef} action={vinculoAction} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <CategoriaField categorias={categorias} id="clickup-categoria" />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="label" htmlFor="clickup-lista">
              Lista do ClickUp (ID ou URL)
            </label>
            <input className="input" id="clickup-lista" name="clickUpListId" placeholder="ex.: 901326339447" required />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="label" htmlFor="clickup-tarefa">
              Tarefa do ClickUp (ID ou URL)
            </label>
            <input className="input" id="clickup-tarefa" name="clickUpTaskId" placeholder="ex.: 86ahe39fe" required />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="clickup-padroes">
            Padrões (um por linha) — texto que aparece no "Serviço/Plano" da fatura
          </label>
          <textarea
            className="input"
            id="clickup-padroes"
            name="padroes"
            rows={3}
            placeholder={"Batial\nEV - Endereço Fiscal Batial"}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Soma toda fatura cujo Serviço/Plano contenha qualquer um desses textos (sem diferenciar maiúscula/minúscula) —
            de QUALQUER cliente. Use "Pré-visualizar" antes de vincular pra conferir exatamente o que vai casar.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary disabled:opacity-60"
            onClick={handlePreVisualizar}
            disabled={previewPending}
          >
            {previewPending ? "Consultando…" : "Pré-visualizar"}
          </button>
          <BotaoSalvar>Vincular</BotaoSalvar>
        </div>
      </form>

      <TabelaPreview preview={previewState} />

      {vinculoState.error ? <p className="mt-2 text-sm text-red-600">{vinculoState.error}</p> : null}
      {vinculoState.ok ? <p className="mt-2 text-sm text-emerald-700">{vinculoState.ok}</p> : null}
      {vinculoState.aviso ? <p className="mt-2 text-sm text-amber-700">{vinculoState.aviso}</p> : null}
    </div>
  );
}

function BotaoEmpurrar() {
  // useFormStatus só enxerga o <form> quando chamado de um componente FILHO
  // dele — nunca do mesmo componente que renderiza o <form> (mesmo padrão de
  // BotaoSalvar acima).
  const { pending } = useFormStatus();
  return (
    <button className="btn-secondary px-2 py-1 text-xs disabled:opacity-60" type="submit" disabled={pending}>
      {pending ? "Enviando…" : "Empurrar agora"}
    </button>
  );
}

/** Botão "Empurrar agora": força o envio ignorando a checagem de "valor mudou?" — serve para testar um vínculo. */
export function EmpurrarAgoraButton({ vinculoId }: { vinculoId: string }) {
  const [state, action] = useActionState<PushAgoraState, FormData>(empurrarAgoraAction, estadoInicialPush);

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="vinculoId" value={vinculoId} />
        <BotaoEmpurrar />
      </form>
      {state.error ? <p className="mt-1 text-xs text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="mt-1 text-xs text-emerald-700">{state.ok}</p> : null}
    </div>
  );
}
