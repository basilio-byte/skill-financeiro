"use client";

import { useState, useTransition } from "react";
import { formatBRL } from "@/lib/money";
import { detalharVinculoAction, type DetalheState } from "@/lib/clickup/actions";
import type { LinhaDaComposicao, LinhaExcluidaDaComposicao } from "@/lib/clickup/composicao";

/**
 * Linha da tabela de vínculos que EXPANDE mostrando as faturas que compõem o
 * valor enviado ao ClickUp.
 *
 * As células da linha vêm prontas do Server Component (`children`) — inclusive
 * o form com a server action de ativar/desativar. Este componente só acrescenta
 * a célula do botão e a linha expandida, no mesmo padrão de `LinhaRevisaoRow`
 * (dois `<tr>` num fragmento, painel em `<td colSpan>` cinza).
 *
 * Carrega sob demanda (`useTransition` + chamada direta da Server Action), o
 * mesmo caminho já comprovado pelo botão "Pré-visualizar" — nada é buscado até
 * alguém clicar, porque isso é uma consulta por vínculo e a tabela tem dezenas.
 */
export function LinhaVinculoDetalhavel({
  vinculoId,
  colunas,
  children,
}: {
  vinculoId: string;
  /** Total de colunas da tabela, para o colSpan do painel. */
  colunas: number;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [detalhe, setDetalhe] = useState<DetalheState | null>(null);
  const [carregando, startTransition] = useTransition();

  function alternar() {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    // Recarrega a cada abertura: a receita do mês corrente muda a cada
    // sincronização (15 min), então um resultado guardado da abertura anterior
    // envelheceria em silêncio.
    startTransition(async () => setDetalhe(await detalharVinculoAction(vinculoId)));
  }

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        {children}
        <td className="py-2 pr-4">
          <button type="button" onClick={alternar} className="btn-secondary whitespace-nowrap px-2 py-1 text-xs">
            {aberto ? "Ocultar faturas" : "Ver faturas"}
          </button>
        </td>
      </tr>
      {aberto ? (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={colunas} className="px-3 py-3">
            {carregando && !detalhe ? (
              <p className="text-xs text-slate-500">Consultando…</p>
            ) : detalhe ? (
              <PainelDetalhe detalhe={detalhe} />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  // A data vem como @db.Date (meia-noite UTC) — formatar em UTC evita que um
  // fuso negativo mostre o dia anterior.
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

function Marcadores({ linha }: { linha: LinhaDaComposicao }) {
  return (
    <>
      {linha.proporcionado === "S" ? (
        <span
          className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-600"
          title="Valor rateado entre as categorias desta mesma fatura — por isso é menor que o total da fatura."
        >
          rateado
        </span>
      ) : null}
      {linha.revisadoManualmente ? (
        <span
          className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800"
          title="Categoria e/ou valor desta linha foram corrigidos manualmente por alguém."
        >
          revisada
        </span>
      ) : null}
    </>
  );
}

function PainelDetalhe({ detalhe }: { detalhe: DetalheState }) {
  if (detalhe.error) return <p className="text-xs text-red-600">{detalhe.error}</p>;
  if (!detalhe.incluidas) return null;

  const { incluidas, excluidas = [], totalAtual, ultimoEnviado, divergente, ano, mes } = detalhe;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs font-medium text-slate-600">
          Faturas de {String(mes).padStart(2, "0")}/{ano}
        </span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{formatBRL(totalAtual ?? "0")}</span>
        <span className="text-xs text-slate-400">
          {incluidas.length} fatura(s) — soma recalculada agora
        </span>
      </div>

      {ultimoEnviado ? (
        <p className={`text-xs ${divergente ? "text-amber-800" : "text-slate-500"}`}>
          Último valor enviado ao ClickUp: <strong>{formatBRL(ultimoEnviado.valor)}</strong> em{" "}
          {fmtDataHora(ultimoEnviado.enviadoEm)}.
          {divergente ? (
            <span className="mt-1 block rounded-md border border-amber-200 bg-amber-50 p-2">
              A receita mudou desde esse envio — a lista abaixo soma{" "}
              <strong>{formatBRL(totalAtual ?? "0")}</strong>, não o valor que está hoje no ClickUp. A próxima
              sincronização corrige o campo lá.
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Nenhum envio bem-sucedido neste mês ainda — os valores abaixo são o que a próxima sincronização vai empurrar.</p>
      )}

      {incluidas.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhuma fatura casa com esta categoria + padrões neste mês.</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="px-2 py-1.5">Fatura</th>
                <th className="px-2 py-1.5">Cliente</th>
                <th className="px-2 py-1.5">Serviço/Plano (Conexa)</th>
                <th className="px-2 py-1.5">Data Crédito</th>
                <th className="px-2 py-1.5 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {incluidas.map((l) => {
                // `dividida` vem decidido do servidor (comparação de Decimal) —
                // comparar as strings aqui marcava toda mensalidade redonda como
                // dividida, porque o Decimal do Prisma derruba zeros à direita.
                const dividida = l.dividida;
                return (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 tabular-nums text-slate-500">{l.crConexaId}</td>
                    <td className="px-2 py-1.5">{l.razaoSocial ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {/* Quando a fatura combina produtos, mostrar só o que é DESTE
                          vínculo — repetir o texto concatenado inteiro faria parecer
                          que ele recebeu tudo. */}
                      {dividida && l.itensAtribuidos ? (
                        <>
                          {l.itensAtribuidos.map((it) => it.servicoItem).join("; ")}
                          <span
                            className="ml-1 rounded bg-seahub-100 px-1 py-0.5 text-[10px] text-seahub-700"
                            title={`A fatura tem outros produtos além deste. Total da fatura nesta categoria: ${formatBRL(l.valorRecebidoCat)} — aqui entra só a parte deste vínculo.`}
                          >
                            parte da fatura
                          </span>
                        </>
                      ) : (
                        l.servicoOuPlano
                      )}
                      <Marcadores linha={l} />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-500">{fmtData(l.dataCredito)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatBRL(l.valorAtribuido)}
                      {dividida ? (
                        <span className="block text-[10px] text-slate-400">de {formatBRL(l.valorRecebidoCat)}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="px-2 py-1.5" colSpan={4}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatBRL(totalAtual ?? "0")}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {excluidas.length > 0 ? <ExcluidasBloco excluidas={excluidas} /> : null}
    </div>
  );
}

/**
 * Linhas que casam o padrão deste vínculo mas NÃO somam aqui — um vínculo mais
 * antigo da mesma categoria já ficou com elas (fatura que combina vários
 * produtos numa linha só). Mostrar isso é o ponto: sem esta seção, a fatura
 * simplesmente sumiria da lista e a pergunta "cadê a fatura X?" ficaria sem
 * resposta na tela.
 */
function ExcluidasBloco({ excluidas }: { excluidas: LinhaExcluidaDaComposicao[] }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-500 outline-none transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-seahub-300">
        <span className="inline-block transition group-open:rotate-90">›</span> {excluidas.length} fatura(s) casam o
        padrão mas somam em outro vínculo
      </summary>
      <div className="border-t border-slate-100 px-3 py-2">
        <p className="mb-2 text-[11px] text-slate-500">
          São faturas que combinam mais de um produto na mesma linha e em que este vínculo não ficou com nada. Quando a
          fatura tem detalhe por item, ela é <strong>repartida</strong> entre as tarefas de cada produto (a coluna
          mostra pra onde foi cada parte). Sem esse detalhe — fatura antiga, sem lançamento casado, ou linha corrigida à
          mão — não dá pra dividir, e a tarefa mais antiga fica com a linha inteira.
        </p>
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="px-2 py-1">Fatura</th>
              <th className="px-2 py-1">Serviço/Plano (Conexa)</th>
              <th className="px-2 py-1">Pra onde foi</th>
              <th className="px-2 py-1 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {excluidas.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 align-top text-slate-500">
                <td className="px-2 py-1 tabular-nums">{l.crConexaId}</td>
                <td className="px-2 py-1">{l.servicoOuPlano}</td>
                <td className="px-2 py-1">
                  {l.repartidaEntre && l.repartidaEntre.length > 0 ? (
                    // Repartida: mostra cada parte e o seu destino. Dizer "R$ 123,75
                    // somando na tarefa X" seria falso — X levou só a parte dele.
                    l.repartidaEntre.map((p, i) => (
                      <span key={`${p.taskId}-${i}`} className="block">
                        <a
                          href={`https://app.clickup.com/t/${p.taskId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-seahub-600 hover:underline"
                        >
                          {p.taskId}
                        </a>
                        <span className="text-slate-400"> · {formatBRL(p.valor)}</span>
                      </span>
                    ))
                  ) : (
                    <a
                      href={`https://app.clickup.com/t/${l.reivindicadaPorTaskId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-seahub-600 hover:underline"
                    >
                      {l.reivindicadaPorTaskId}
                    </a>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatBRL(l.valorRecebidoCat)}
                  {l.repartidaEntre && l.repartidaEntre.length > 0 ? (
                    <span className="block text-[10px] text-slate-400">total da fatura, repartido</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
