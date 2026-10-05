"use client";

import { useState, useTransition } from "react";
import { acaoCriarTokenMcp, acaoRevogarTokenMcp } from "@/lib/mcp/token-actions";

export interface TokenLinha {
  id: string;
  nome: string;
  prefixo: string;
  escopo: "LEITURA" | "ESCRITA";
  criadoEm: string;
  ultimoUsoEm: string | null;
  revogadoEm: string | null;
  dono: string;
  meu: boolean;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "nunca";

/**
 * Tokens pessoais do MCP (ADR-0033).
 *
 * ⚠ O token em texto aparece UMA vez, logo após criar. O banco guarda só o hash:
 * perdeu, revogue e crie outro. Por isso o valor fica só em estado local do componente
 * e some ao fechar — nunca é enviado de volta pelo servidor depois.
 */
export function TokensMcpPanel({ tokens, ehAdmin, urlDoMcp }: { tokens: TokenLinha[]; ehAdmin: boolean; urlDoMcp: string }) {
  const [nome, setNome] = useState("");
  const [escopo, setEscopo] = useState<"LEITURA" | "ESCRITA">("LEITURA");
  const [novo, setNovo] = useState<{ token: string; nome: string; escopo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pendente, iniciar] = useTransition();

  const comando = novo
    ? `claude mcp add --transport http --scope local seahub-financeiro ${urlDoMcp} --header "Authorization: Bearer ${novo.token}"`
    : "";

  function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      try {
        setNovo(await acaoCriarTokenMcp(nome, escopo));
        setNome("");
        setCopiado(false);
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Falha ao criar o token.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {novo ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            Token “{novo.nome}” criado ({novo.escopo === "ESCRITA" ? "leitura e escrita" : "somente leitura"}). Copie agora: ele não aparece de novo.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-card p-2 text-xs text-slate-800">{comando}</pre>
          <p className="mt-2 text-xs">
            <strong>Conector da claude.ai:</strong> URL <code className="rounded bg-card px-1">{urlDoMcp}</code>, em “Cabeçalhos de
            requisição” use o nome <code className="rounded bg-card px-1">x-api-key</code> (o <code>authorization</code> é
            reservado ao OAuth) e, como valor, o token abaixo.
          </p>
          <pre className="mt-1 overflow-x-auto rounded bg-card p-2 text-xs text-slate-800">{novo.token}</pre>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(comando);
                setCopiado(true);
              }}
            >
              {copiado ? "Copiado ✓" : "Copiar comando"}
            </button>
            <button className="btn-secondary" onClick={() => setNovo(null)}>
              Já guardei, fechar
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={criar} className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Nome do token</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Claude Code do notebook" maxLength={60} className="input w-64" required />
        </label>
        <label className="block">
          <span className="label">Acesso</span>
          <select value={escopo} onChange={(e) => setEscopo(e.target.value as "LEITURA" | "ESCRITA")} className="input w-56">
            <option value="LEITURA">Somente leitura</option>
            {ehAdmin ? <option value="ESCRITA">Leitura e escrita</option> : null}
          </select>
        </label>
        <button className="btn" disabled={pendente || !nome.trim()}>
          {pendente ? "Criando…" : "Criar token"}
        </button>
      </form>
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
      {!ehAdmin ? <p className="text-xs text-slate-500">Visualizadores só podem criar tokens de leitura.</p> : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum token ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4">Nome</th>
                <th className="pb-2 pr-4">Início</th>
                <th className="pb-2 pr-4">Acesso</th>
                {ehAdmin ? <th className="pb-2 pr-4">Dono</th> : null}
                <th className="pb-2 pr-4">Último uso</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className={`border-t border-slate-100 ${t.revogadoEm ? "text-slate-400" : ""}`}>
                  <td className="py-2 pr-4">{t.nome}</td>
                  <td className="tabular py-2 pr-4 text-xs">{t.prefixo}…</td>
                  <td className="py-2 pr-4">{t.escopo === "ESCRITA" ? "leitura e escrita" : "leitura"}</td>
                  {ehAdmin ? <td className="py-2 pr-4 text-xs">{t.dono}</td> : null}
                  <td className="py-2 pr-4 text-xs">{fmt(t.ultimoUsoEm)}</td>
                  <td className="py-2 text-right">
                    {t.revogadoEm ? (
                      <span className="text-xs">revogado {fmt(t.revogadoEm)}</span>
                    ) : t.meu || ehAdmin ? (
                      <button
                        className="btn-secondary"
                        disabled={pendente}
                        onClick={() => {
                          if (confirm(`Revogar o token “${t.nome}”? Quem o usa perde o acesso na hora.`)) {
                            iniciar(() => acaoRevogarTokenMcp(t.id));
                          }
                        }}
                      >
                        Revogar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
