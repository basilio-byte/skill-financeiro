import type { Metadata } from "next";
import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { formatBRL } from "@/lib/money";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { cn } from "@/lib/ui";
import { lerFiltros, ROTULO_STATUS, type ParamsBrutos } from "@/lib/inadimplencia/dominio";
import {
  consultarInadimplencia,
  POR_PAGINA,
  type LinhaCliente,
  type LinhaCobranca,
} from "@/lib/inadimplencia/consulta";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Inadimplentes" };
export const dynamic = "force-dynamic";

/** Mais velho que isto, o retrato da dívida merece um aviso. */
const OBSOLETO_APOS_MS = 6 * 60 * 60_000;

const data = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function InadimplentesPage({ searchParams }: { searchParams: Promise<ParamsBrutos> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const hoje = keyToUtcDate(todayKey());
  const r = await consultarInadimplencia(f, hoje);

  /** Link para a mesma tela mudando só o que for passado — o resto da URL fica. */
  const href = (mudar: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const atual: Record<string, string> = {
      visao: f.visao,
      de: iso(f.de),
      ate: iso(f.ate),
      q: f.q,
      status: f.status ?? "",
      unidade: f.unidade ?? "",
      ordem: f.ordem,
      dir: f.direcao,
      pagina: String(r.paginaAtual),
    };
    for (const [k, v] of Object.entries({ ...atual, ...mudar })) if (v) p.set(k, v);
    return `/inadimplentes?${p.toString()}`;
  };

  const temFiltro = !!(f.de || f.ate || f.q || f.status || f.unidade);
  const sync = r.sincronizacao;
  const obsoleto = sync.em !== null && Date.now() - sync.em.getTime() > OBSOLETO_APOS_MS;
  const nunca = sync.status === null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo={"Inadimplentes"} descricao={"Cobranças vencidas e não pagas, direto do Conexa."} dica={"Cobranças não pagas com vencimento anterior a hoje. Vence hoje ainda não conta como atraso."} />

      {nunca ? (
        <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">
          A lista ainda não foi sincronizada. A primeira atualização acontece sozinha em poucos minutos depois que o
          serviço estiver configurado com o token da API do Conexa.
        </Card>
      ) : (
        <p className="text-xs text-slate-500">
          Atualizado em{" "}
          <strong>
            {sync.em?.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" })}
          </strong>
          {sync.status === "FAILED" ? (
            <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-red-700">
              a última tentativa falhou — mostrando o último retrato bom{sync.erro ? `: ${sync.erro}` : ""}
            </span>
          ) : obsoleto ? (
            <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
              há mais de 6 horas sem atualizar — os valores podem estar desatualizados
            </span>
          ) : null}
        </p>
      )}

      <KpiStrip>
        <KpiCard
          label="Total em atraso"
          amount={r.totais.valor}
          tone="negative"
          sublabel={temFiltro ? `de ${formatBRL(r.geral.valor)} no geral` : undefined}
        />
        <KpiCard
          label="Cobranças"
          value={r.totais.cobrancas.toLocaleString("pt-BR")}
          sublabel={temFiltro ? `de ${r.geral.cobrancas.toLocaleString("pt-BR")} no geral` : undefined}
        />
        <KpiCard
          label="Clientes"
          value={r.totais.clientes.toLocaleString("pt-BR")}
          sublabel={temFiltro ? `de ${r.geral.clientes.toLocaleString("pt-BR")} no geral` : undefined}
        />
        <KpiCard label="Maior atraso" value={`${r.totais.maiorAtraso.toLocaleString("pt-BR")} dias`} />
      </KpiStrip>

      <Card>
        <SectionTitle hint="atalhos pela idade da dívida (todas as cobranças, sem outros filtros)">
          Faixas de atraso
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {r.faixas.map((fx) => {
            const ativa = iso(f.de) === (fx.de ?? "") && iso(f.ate) === fx.ate;
            return (
              <Link
                key={fx.chave}
                href={ativa ? href({ de: null, ate: null, pagina: null }) : href({ de: fx.de, ate: fx.ate, pagina: null })}
                aria-pressed={ativa}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm transition",
                  ativa ? "border-seahub-600 bg-seahub-50 text-acento-texto" : "border-slate-200 bg-card hover:bg-slate-50",
                )}
              >
                <span className="font-medium">{fx.rotulo}</span>
                <span className="ml-2 tabular text-slate-500">
                  {formatBRL(fx.valor)} · {fx.cobrancas.toLocaleString("pt-BR")}
                </span>
              </Link>
            );
          })}
        </div>
      </Card>

      <Card>
        {/* Formulário GET: o estado vive na URL (colável, sobrevive ao F5) e o servidor filtra. */}
        <form method="get" action="/inadimplentes" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="visao" value={f.visao} />
          <label className="block">
            <span className="label">Vencimento de</span>
            <input type="date" name="de" defaultValue={iso(f.de)} className="input w-40" />
          </label>
          <label className="block">
            <span className="label">até</span>
            <input type="date" name="ate" defaultValue={iso(f.ate)} className="input w-40" />
          </label>
          <label className="block">
            <span className="label">Cliente</span>
            <input name="q" defaultValue={f.q} placeholder="nome ou id" className="input w-48" />
          </label>
          <label className="block">
            <span className="label">Situação</span>
            <select name="status" defaultValue={f.status ?? ""} className="input w-36">
              <option value="">todas</option>
              {Object.entries(ROTULO_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {r.unidades.length > 1 ? (
            <label className="block">
              <span className="label">Unidade</span>
              <select name="unidade" defaultValue={f.unidade ?? ""} className="input w-44">
                <option value="">todas</option>
                {r.unidades.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="label">Ordenar por</span>
            <select name="ordem" defaultValue={f.ordem} className="input w-36">
              <option value="valor">Valor</option>
              <option value="vencimento">Vencimento</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Direção</span>
            <select name="dir" defaultValue={f.direcao} className="input w-44">
              <option value="desc">{f.ordem === "valor" ? "Maior primeiro" : "Mais recente primeiro"}</option>
              <option value="asc">{f.ordem === "valor" ? "Menor primeiro" : "Mais antigo primeiro"}</option>
            </select>
          </label>
          <button className="btn">Aplicar</button>
          {temFiltro ? (
            <Link href={href({ de: null, ate: null, q: null, status: null, unidade: null, pagina: null })} className="btn-secondary">
              Limpar filtros
            </Link>
          ) : null}
        </form>
      </Card>

      <Card className="overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {(["cliente", "cobranca"] as const).map((v) => (
              <Link
                key={v}
                href={href({ visao: v, pagina: null })}
                className={cn(
                  "px-3 py-1.5 font-medium transition",
                  f.visao === v ? "bg-seahub-600 text-white" : "bg-card text-slate-600 hover:bg-slate-50",
                )}
              >
                {v === "cliente" ? "Por cliente" : "Por cobrança"}
              </Link>
            ))}
          </div>
          <span className="text-xs text-slate-400">
            {r.totalDeLinhas.toLocaleString("pt-BR")} {f.visao === "cliente" ? "cliente(s)" : "cobrança(s)"}
            {r.totalDeLinhas > POR_PAGINA ? ` · página ${r.paginaAtual} de ${r.totalDePaginas}` : ""}
          </span>
        </div>

        {r.linhas.length === 0 ? (
          <p className="py-8 text-center text-slate-400">
            {temFiltro
              ? "Nenhuma cobrança com esses filtros."
              : nunca
                ? "Aguardando a primeira sincronização."
                : "Nenhuma cobrança em atraso. 🎉"}
          </p>
        ) : f.visao === "cliente" ? (
          <TabelaClientes linhas={r.linhas as LinhaCliente[]} />
        ) : (
          <TabelaCobrancas linhas={r.linhas as LinhaCobranca[]} />
        )}

        {r.totalDePaginas > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
            {r.paginaAtual > 1 ? (
              <Link href={href({ pagina: String(r.paginaAtual - 1) })} className="btn-secondary">
                ← Anterior
              </Link>
            ) : (
              <span />
            )}
            {r.paginaAtual < r.totalDePaginas ? (
              <Link href={href({ pagina: String(r.paginaAtual + 1) })} className="btn-secondary">
                Próxima →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Card>

      <p className="text-xs text-slate-400">
        Cobranças renegociadas não entram: a dívida passa para a cobrança nova, e listar as duas contaria o mesmo valor
        duas vezes. O valor considera juros e multa, como na tela do Conexa.
      </p>
    </div>
  );
}

const corStatus = (s: string) =>
  s === "juridical" ? "bg-red-100 text-red-800" : s === "protested" ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700";

function Selo({ status }: { status: string }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", corStatus(status))}>
      {ROTULO_STATUS[status] ?? status}
    </span>
  );
}

function Contato({ telefone, email }: { telefone: string | null; email: string | null }) {
  if (!telefone && !email) return <span className="text-slate-300">—</span>;
  return (
    <div className="text-xs text-slate-600">
      {telefone ? <div>{telefone}</div> : null}
      {email ? <div className="max-w-[14rem] truncate text-slate-400">{email}</div> : null}
    </div>
  );
}

function TabelaClientes({ linhas }: { linhas: LinhaCliente[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th className="pb-2 pr-4">Cliente</th>
          <th className="pb-2 pr-4 text-right">Cobranças</th>
          <th className="pb-2 pr-4 text-right">Valor em atraso</th>
          <th className="pb-2 pr-4">Mais antiga</th>
          <th className="pb-2 pr-4 text-right">Atraso</th>
          <th className="pb-2 pr-4">Situação</th>
          <th className="pb-2">Contato</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.customerConexaId ?? l.cliente} className="border-t border-slate-100 align-top">
            <td className="py-2 pr-4">
              <div className="font-medium text-slate-800">{l.cliente}</div>
              <div className="text-xs text-slate-400">
                {l.customerConexaId !== null ? `#${l.customerConexaId}` : ""}
                {l.unidade ? ` · ${l.unidade}` : ""}
              </div>
            </td>
            <td className="tabular py-2 pr-4 text-right">{l.cobrancas}</td>
            <td className="tabular py-2 pr-4 text-right font-medium text-red-700">{formatBRL(l.valor)}</td>
            <td className="tabular py-2 pr-4">{data(l.maisAntigo)}</td>
            <td className="tabular py-2 pr-4 text-right">{l.maiorAtraso.toLocaleString("pt-BR")} d</td>
            <td className="py-2 pr-4">
              <Selo status={l.statusPior} />
            </td>
            <td className="py-2">
              <Contato telefone={l.telefone} email={l.email} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaCobrancas({ linhas }: { linhas: LinhaCobranca[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th className="pb-2 pr-4">Cobrança</th>
          <th className="pb-2 pr-4">Cliente</th>
          <th className="pb-2 pr-4">Vencimento</th>
          <th className="pb-2 pr-4 text-right">Atraso</th>
          <th className="pb-2 pr-4 text-right">Valor</th>
          <th className="pb-2 pr-4">Situação</th>
          <th className="pb-2">Contato</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.conexaId} className="border-t border-slate-100 align-top">
            <td className="tabular py-2 pr-4 text-slate-500">#{l.conexaId}</td>
            <td className="py-2 pr-4">
              <div className="font-medium text-slate-800">{l.cliente}</div>
              <div className="text-xs text-slate-400">{l.unidade ?? ""}</div>
            </td>
            <td className="tabular py-2 pr-4">{data(l.vencimento)}</td>
            <td className="tabular py-2 pr-4 text-right">{l.diasDeAtraso.toLocaleString("pt-BR")} d</td>
            <td className="tabular py-2 pr-4 text-right font-medium text-red-700">
              {formatBRL(l.valor)}
              {l.valor !== l.valorOriginal ? (
                <div className="text-[11px] font-normal text-slate-400" title="Valor original, sem juros e multa">
                  orig. {formatBRL(l.valorOriginal)}
                </div>
              ) : null}
            </td>
            <td className="py-2 pr-4">
              <Selo status={l.status} />
            </td>
            <td className="py-2">
              <Contato telefone={l.telefone} email={l.email} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
