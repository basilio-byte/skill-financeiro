"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dica } from "@/components/dica";
import { Selo } from "@/components/selo";
import type { PreviaImportacao } from "@/lib/categorization/importacao";

/**
 * Importação manual dos exports do Conexa (ADR-0034): dois arquivos + o período → PRÉVIA do que
 * mudaria (nada é gravado) → confirmação → importação. Só apresentação e envio: toda a regra
 * (validação, o que seria removido, selo) vive no servidor.
 */

const brl = (v: string) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nomeDoMes = (aaaaMm: string) => {
  const [a, m] = aaaaMm.split("-").map(Number);
  const t = new Date(Date.UTC(a!, m! - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const doisDigitos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

function periodoRapido(qual: "passado" | "atual"): { inicio: string; fim: string } {
  const hoje = new Date();
  if (qual === "atual") return { inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: iso(hoje) };
  return {
    inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
    fim: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)),
  };
}

type Fase = null | "previa" | "importar";

export function ImportarForm({ jaEmAndamento = false }: { jaEmAndamento?: boolean }) {
  const router = useRouter();
  const [contasReceber, setContasReceber] = useState<File | null>(null);
  const [listarVendas, setListarVendas] = useState<File | null>(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [confirmou, setConfirmou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>(null);

  const invalidarPrevia = () => {
    setPrevia(null);
    setConfirmou(false);
    setErro(null);
  };

  const pronto = !!contasReceber && !!listarVendas && !!inicio && !!fim;
  const bloqueada = !!previa?.alertas.some((a) => a.nivel === "bloqueio");
  const podeImportar = !!previa && !bloqueada && (!previa.exigeConfirmacao || confirmou) && fase === null && !jaEmAndamento;

  function montar(acao: "previa" | "importar"): FormData {
    const f = new FormData();
    f.set("acao", acao);
    f.set("periodoInicio", inicio);
    f.set("periodoFim", fim);
    f.set("contasReceber", contasReceber!);
    f.set("listarVendas", listarVendas!);
    if (acao === "importar") {
      f.set("selo", previa!.selo);
      f.set("confirmacao", String(confirmou));
    }
    return f;
  }

  async function enviar(acao: "previa" | "importar") {
    setErro(null);
    setFase(acao);
    try {
      const res = await fetch("/api/runs/importar", { method: "POST", body: montar(acao) });
      const corpo = (await res.json().catch(() => null)) as { error?: string; previa?: PreviaImportacao; runId?: string } | null;
      if (!res.ok || !corpo) {
        setErro(corpo?.error ?? `Falha ao enviar (HTTP ${res.status}).`);
        if (acao === "importar" && res.status === 409) setPrevia(null);
        return;
      }
      if (acao === "previa" && corpo.previa) {
        setPrevia(corpo.previa);
        setConfirmou(false);
      } else if (acao === "importar" && corpo.runId) {
        router.push(`/runs/${corpo.runId}`);
        router.refresh();
      }
    } catch {
      setErro("Não foi possível falar com o servidor. Verifique a conexão e tente de novo.");
    } finally {
      setFase(null);
    }
  }

  return (
    <section className="card space-y-4" aria-labelledby="importar-titulo">
      <div>
        <h2 id="importar-titulo" className="flex items-center gap-1.5 font-semibold text-slate-900">
          Importar arquivos do Conexa
          <Dica>
            Use quando a sincronização automática estiver bloqueada pelo captcha do Conexa. No Conexa, exporte (Excel) os
            dois relatórios com o MESMO filtro de Data de Crédito da Cobrança — Contas a Receber e Listar Vendas — e envie
            os arquivos exatamente como baixou, sem abrir e salvar no Excel. O período abaixo deve ser o mesmo do filtro.
            Para fechar um mês, exporte e importe o mês inteiro: tudo que está dentro do período e não vem no arquivo é
            removido (a prévia mostra isso antes de gravar).
          </Dica>
        </h2>
        <p className="text-sm text-slate-500">Os mesmos dois exports, enviados por você em vez de baixados pelo sistema.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="imp-cr">
            Contas a Receber (.xlsx)
          </label>
          <input
            id="imp-cr"
            className="input"
            type="file"
            accept=".xlsx"
            disabled={jaEmAndamento}
            onChange={(e) => {
              setContasReceber(e.target.files?.[0] ?? null);
              invalidarPrevia();
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="imp-lv">
            Listar Vendas (.xlsx)
          </label>
          <input
            id="imp-lv"
            className="input"
            type="file"
            accept=".xlsx"
            disabled={jaEmAndamento}
            onChange={(e) => {
              setListarVendas(e.target.files?.[0] ?? null);
              invalidarPrevia();
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="imp-inicio">
            Data início
          </label>
          <input
            id="imp-inicio"
            className="input"
            type="date"
            value={inicio}
            disabled={jaEmAndamento}
            onChange={(e) => {
              setInicio(e.target.value);
              invalidarPrevia();
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="imp-fim">
            Data fim
          </label>
          <input
            id="imp-fim"
            className="input"
            type="date"
            value={fim}
            disabled={jaEmAndamento}
            onChange={(e) => {
              setFim(e.target.value);
              invalidarPrevia();
            }}
          />
        </div>
        <div className="flex gap-2">
          {(["passado", "atual"] as const).map((q) => (
            <button
              key={q}
              type="button"
              className="btn-secondary"
              disabled={jaEmAndamento}
              onClick={() => {
                const p = periodoRapido(q);
                setInicio(p.inicio);
                setFim(p.fim);
                invalidarPrevia();
              }}
            >
              {q === "passado" ? "Mês passado" : "Mês atual"}
            </button>
          ))}
        </div>
        <button className="btn" type="button" disabled={!pronto || fase !== null || jaEmAndamento} onClick={() => enviar("previa")}>
          {fase === "previa" ? "Analisando..." : "Pré-visualizar"}
        </button>
      </div>

      {jaEmAndamento ? (
        <p className="text-xs text-slate-500">Já existe uma sincronização em andamento — aguarde ela terminar.</p>
      ) : null}
      {erro ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      {previa ? <Previa previa={previa} /> : null}

      {previa ? (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          {previa.exigeConfirmacao ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmou}
                disabled={bloqueada}
                onChange={(e) => setConfirmou(e.target.checked)}
              />
              <span>
                Conferi a prévia e confirmo
                {previa.mudancas.removidas > 0
                  ? ` a remoção de ${previa.mudancas.removidas} linha(s) (${brl(previa.mudancas.removidasValor)})`
                  : " a redução do total"}
                .
              </span>
            </label>
          ) : null}
          <button className="btn" type="button" disabled={!podeImportar} onClick={() => enviar("importar")}>
            {fase === "importar" ? "Importando..." : "Importar e categorizar"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Previa({ previa }: { previa: PreviaImportacao }) {
  const { leitura: l, mudancas: m } = previa;
  return (
    <div className="space-y-4" aria-live="polite">
      {previa.alertas.length > 0 ? (
        <ul className="space-y-2">
          {previa.alertas.map((a, i) => (
            <li
              key={i}
              className={
                a.nivel === "bloqueio"
                  ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              }
            >
              <span className="font-medium">{a.nivel === "bloqueio" ? "Bloqueado: " : "Atenção: "}</span>
              {a.texto}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-sm text-slate-600">
        {l.faturasNoArquivo.toLocaleString("pt-BR")} fatura(s) no arquivo · {l.faturasAceitasNoPeriodo.toLocaleString("pt-BR")}{" "}
        com crédito no período · {l.faturasIgnoradas.toLocaleString("pt-BR")} ignorada(s) · {l.itensDeVenda.toLocaleString("pt-BR")}{" "}
        item(ns) de venda · total {brl(l.totalRecebido)}
      </p>

      <div className="flex flex-wrap gap-2">
        <Selo tom="bom">{m.novas.toLocaleString("pt-BR")} nova(s)</Selo>
        <Selo tom="info">{m.atualizadas.toLocaleString("pt-BR")} atualizada(s)</Selo>
        <Selo tom={m.removidas > 0 ? "critico" : "neutro"}>
          {m.removidas.toLocaleString("pt-BR")} removida(s){m.removidas > 0 ? ` · ${brl(m.removidasValor)}` : ""}
        </Selo>
        {m.preservadasPorRevisao > 0 ? <Selo tom="atencao">{m.preservadasPorRevisao} preservada(s) por revisão</Selo> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] sm:text-sm">
          <thead>
            <tr>
              <th className="pb-2 pr-2 sm:pr-4">Mês</th>
              <th className="pb-2 pr-2 text-right sm:pr-4">Hoje no painel</th>
              <th className="pb-2 pr-2 text-right sm:pr-4">Depois de importar</th>
              <th className="pb-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {previa.meses.map((mes) => {
              const dif = Number(mes.diferenca);
              return (
                <tr key={mes.mes} className="border-t border-slate-100">
                  <td className="py-2 pr-2 sm:pr-4">{nomeDoMes(mes.mes)}</td>
                  <td className="tabular py-2 pr-2 text-right sm:pr-4">{brl(mes.antes)}</td>
                  <td className="tabular py-2 pr-2 text-right font-medium sm:pr-4">{brl(mes.depois)}</td>
                  <td
                    className={`tabular py-2 text-right ${dif < 0 ? "text-red-600" : dif > 0 ? "text-emerald-700" : "text-slate-500"}`}
                  >
                    {dif > 0 ? "+" : ""}
                    {brl(mes.diferenca)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {previa.removidasAmostra.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">
            Maiores linhas que seriam removidas ({previa.removidasAmostra.length} de {m.removidas})
          </summary>
          <ul className="mt-2 space-y-1 text-slate-600">
            {previa.removidasAmostra.map((r, i) => (
              <li key={i} className="tabular">
                Fatura {r.crConexaId} · {nomeDoMes(r.mes)} · {r.categoria} · {brl(r.valor)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">Total por categoria no arquivo</summary>
        <ul className="mt-2 space-y-1 text-slate-600">
          {previa.categorias.map((c) => (
            <li key={c.categoria} className="tabular flex justify-between gap-4">
              <span>{c.categoria}</span>
              <span>{brl(c.total)}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
