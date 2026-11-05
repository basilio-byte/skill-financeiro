import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { getPeriodBounds, shiftPeriodKey, todayKey } from "@/lib/dates";
import { GRUPOS_RECEITA } from "@/lib/exportacao/colunas-receita";
import { dataBr, lerFiltrosReceita, ROTULO_PROPORCIONADO, VAZIO, PROPORCIONADOS, type ParamsBrutos } from "@/lib/exportacao/filtros-receita";
import { frescorDaReceita } from "@/lib/exportacao/frescor";
import { opcoesDeReceita } from "@/lib/exportacao/opcoes-receita";
import { previaReceita } from "@/lib/exportacao/receita";
import { MAX_LINHAS, type Papel } from "@/lib/exportacao/tipos";
import { Caixa, ErrosDoPedido, Grupo, OpcaoComDescricao, RodapeDeDownload, formatoDe, href, mesPorExtenso } from "./campos";

/**
 * Painel de exportação de RECEITA (ADR-0035): filtros → prévia (o que este recorte vai entregar) → download.
 *
 * Tudo por GET e sem JavaScript, como /revisar e /inadimplentes: o estado vive na URL (colável, favoritável). O botão
 * "Baixar" é um submit do MESMO formulário com `formAction` na rota de download — baixa exatamente o que está nos
 * campos agora; a aba Leia-me do arquivo lista os filtros que valeram.
 */

const ID_FORM = "form-exportar-receita";

export async function PainelReceita({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  const enviado = params.f !== undefined;
  // Primeira visita (sem formulário enviado nem mês): abre no mês corrente — o pedido típico.
  const hoje = todayKey();
  const efetivos: ParamsBrutos = enviado || params.mes !== undefined || params.de !== undefined || params.ate !== undefined ? params : { ...params, mes: hoje.slice(0, 7) };
  const { filtros, erros } = lerFiltrosReceita(efetivos);

  const [opcoes, previa, frescor] = await Promise.all([
    opcoesDeReceita(),
    erros.length ? Promise.resolve(null) : previaReceita(filtros),
    frescorDaReceita(new Date()),
  ]);

  const meses = [...opcoes.meses];
  if (filtros.mes && !meses.includes(filtros.mes)) meses.unshift(filtros.mes);

  const base: Array<[string, string]> = [["dataset", "receita"], ["f", "1"], ["grupos", "fatura"]];
  const mesAtual = hoje.slice(0, 7);
  const mesAnterior = shiftPeriodKey(getPeriodBounds("month").fromKey, "month", -1).slice(0, 7);
  const tri = getPeriodBounds("quarter");
  const ano = getPeriodBounds("year");
  const atalhos: Array<{ rotulo: string; dica: string; url: string }> = [
    { rotulo: "Mês atual", dica: "Do dia 1 até hoje: o mês ainda está em andamento.", url: href([...base, ["mes", mesAtual]]) },
    { rotulo: "Mês anterior", dica: mesPorExtenso(mesAnterior), url: href([...base, ["mes", mesAnterior]]) },
    { rotulo: "Trimestre atual", dica: tri.label, url: href([...base, ["de", tri.fromKey], ["ate", tri.toKey]]) },
    { rotulo: "Ano atual", dica: ano.label, url: href([...base, ["de", ano.fromKey], ["ate", ano.toKey]]) },
    {
      rotulo: "Pendentes de revisão",
      dica: "A fila da tela Revisar: rateadas (S) ou sem Listar Vendas, ainda não revisadas, sem as linhas de valor zero — todos os meses.",
      url: href([...base, ["grupos", "auditoria"], ["proporcionado", "S"], ["proporcionado", "SEM_LV"], ["revisada", "nao"], ["semZeradas", "1"]]),
    },
    { rotulo: "Sem categoria", dica: "Linhas em “Sem Categoria” — todos os meses.", url: href([...base, ["categoria", "Sem Categoria"]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Filtros, prévia e download.">Receita</SectionTitle>

        <div className="mb-5">
          <p className="label">Atalhos</p>
          <div className="flex flex-wrap gap-2">
            {atalhos.map((a) => (
              <Link key={a.rotulo} href={a.url} title={a.dica} className="btn-secondary px-3 py-1.5 text-[13px]">
                {a.rotulo}
              </Link>
            ))}
          </div>
        </div>

        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="receita" />
          <input type="hidden" name="f" value="1" />

          <fieldset>
            <legend className="label">Período — Data de Crédito da Cobrança (o mesmo critério do Panorama)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ex-mes">
                  Mês
                </label>
                <select id="ex-mes" name="mes" className="input" defaultValue={filtros.mes ?? ""}>
                  <option value="">Todos os meses</option>
                  {meses.map((m) => (
                    <option key={m} value={m}>
                      {mesPorExtenso(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ex-de">
                  Ou de
                </label>
                <input id="ex-de" type="date" name="de" defaultValue={filtros.de ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="ex-ate">
                  até
                </label>
                <input id="ex-ate" type="date" name="ate" defaultValue={filtros.ate ?? ""} className="input" />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">Se preencher as datas, elas valem no lugar do mês.</p>
          </fieldset>

          <div className="grid gap-5 lg:grid-cols-2">
            <Grupo legenda="Unidade" dica="Nenhuma marcada = todas.">
              {opcoes.unidades.map((u) => (
                <Caixa key={u} nome="unidade" valor={u} rotulo={u} marcado={filtros.unidades.includes(u)} />
              ))}
              {opcoes.temUnidadeVazia ? <Caixa nome="unidade" valor={VAZIO} rotulo="(sem unidade)" marcado={filtros.unidades.includes(VAZIO)} /> : null}
            </Grupo>
            <Grupo legenda="Situação da cobrança" dica="Nenhuma marcada = todas.">
              {opcoes.status.map((s) => (
                <Caixa key={s} nome="status" valor={s} rotulo={s} marcado={filtros.status.includes(s)} />
              ))}
            </Grupo>
            <Grupo legenda="Rateio (Proporcionado)" dica="Como a categoria foi atribuída. Nenhuma marcada = todos.">
              {PROPORCIONADOS.map((p) => (
                <Caixa key={p} nome="proporcionado" valor={p} rotulo={ROTULO_PROPORCIONADO[p]} marcado={filtros.proporcionados.includes(p)} />
              ))}
            </Grupo>
            <div>
              <label className="label" htmlFor="ex-revisada">
                Revisão manual
              </label>
              <select id="ex-revisada" name="revisada" className="input" defaultValue={filtros.revisada ?? ""}>
                <option value="">Todas as linhas</option>
                <option value="sim">Somente revisadas manualmente</option>
                <option value="nao">Somente NÃO revisadas</option>
              </select>
            </div>
          </div>

          <details open={filtros.categorias.length > 0} className="rounded-lg border border-slate-200/80 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-slate-700">
              Categoria{filtros.categorias.length ? ` — ${filtros.categorias.length} selecionada(s)` : " — todas"}
            </summary>
            <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {opcoes.categorias.map((c) => (
                <Caixa key={c} nome="categoria" valor={c} rotulo={c} marcado={filtros.categorias.includes(c)} />
              ))}
            </div>
          </details>

          <details open={filtros.contas.length > 0} className="rounded-lg border border-slate-200/80 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-slate-700">
              Conta{filtros.contas.length ? ` — ${filtros.contas.length} selecionada(s)` : " — todas"}
            </summary>
            <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
              {opcoes.contas.map((c) => (
                <Caixa key={c} nome="conta" valor={c} rotulo={c} marcado={filtros.contas.includes(c)} />
              ))}
              {opcoes.temContaVazia ? <Caixa nome="conta" valor={VAZIO} rotulo="(sem conta informada)" marcado={filtros.contas.includes(VAZIO)} /> : null}
            </div>
          </details>

          <fieldset>
            <legend className="label">Busca</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <label className="label" htmlFor="ex-cliente">
                  Cliente (nome ou ID)
                </label>
                <input id="ex-cliente" name="cliente" defaultValue={filtros.cliente ?? ""} placeholder="parte do nome" className="input" aria-describedby="ex-busca-nota" />
              </div>
              <div className="lg:col-span-2">
                <label className="label" htmlFor="ex-servico">
                  Serviço/plano contém
                </label>
                <input id="ex-servico" name="servico" defaultValue={filtros.servico ?? ""} placeholder="ex.: Batial" className="input" aria-describedby="ex-busca-nota" />
              </div>
              <div>
                <label className="label" htmlFor="ex-fatura">
                  ID da fatura
                </label>
                <input id="ex-fatura" name="fatura" inputMode="numeric" defaultValue={filtros.fatura ?? ""} placeholder="ex.: 29113" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="ex-vmin">
                  Valor Cat. mínimo (R$)
                </label>
                <input id="ex-vmin" name="valorMin" type="number" step="0.01" defaultValue={filtros.valorMin ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="ex-vmax">
                  Valor Cat. máximo (R$)
                </label>
                <input id="ex-vmax" name="valorMax" type="number" step="0.01" defaultValue={filtros.valorMax ?? ""} className="input" />
              </div>
            </div>
            <p id="ex-busca-nota" className="mt-1.5 text-xs text-slate-500">
              A busca por texto é literal: não diferencia maiúsculas, mas acentos e espaços contam (“Sala 08 - Loja” e “Sala 08  - Loja”, com dois espaços, são buscas diferentes).
            </p>
            <div className="mt-2">
              <Caixa nome="semZeradas" valor="1" rotulo="Ignorar linhas de valor R$ 0,00 (como a fila do Revisar)" marcado={filtros.semZeradas} />
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">O que vai no arquivo</legend>
            <div className="flex flex-col gap-2">
              {GRUPOS_RECEITA.map((g) => {
                const bloqueado = g.somenteAdmin && papel !== "ADMIN";
                return (
                  <div key={g.id} className="flex items-start gap-2">
                    <input
                      id={`ex-grupo-${g.id}`}
                      type="checkbox"
                      name="grupos"
                      value={g.id}
                      defaultChecked={g.fixo ? true : filtros.grupos.includes(g.id)}
                      disabled={g.fixo || bloqueado}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <label htmlFor={`ex-grupo-${g.id}`} className="text-[13.5px] text-slate-700">
                      <span className="font-medium">{g.rotulo}</span>
                      {g.fixo ? <span className="text-slate-400"> (sempre)</span> : null}
                      {bloqueado ? <span className="text-slate-400"> — somente administrador</span> : null}
                      <span className="block text-xs text-slate-500">{g.descricao}</span>
                    </label>
                  </div>
                );
              })}
              <OpcaoComDescricao
                id="ex-resumos"
                nome="resumos"
                valor="1"
                rotulo="Abas de resumo"
                descricao="Por categoria, conta, unidade, situação, rateio e dia — e por mês e categoria × mês quando o recorte cobre mais de um mês."
                marcado={filtros.resumos}
              />
              <OpcaoComDescricao
                id="ex-itens"
                nome="itens"
                valor="1"
                rotulo="Aba Itens"
                descricao="Os itens do Listar Vendas que compõem cada linha e o valor rateado de cada um (a soma bate com o detalhe). Só no .xlsx."
                marcado={filtros.itens}
              />
            </div>
          </fieldset>

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <Link href="/exportar?dataset=receita" className="ml-3 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle hint="do recorte aplicado acima">Prévia do arquivo</SectionTitle>

        {erros.length > 0 ? (
          <ErrosDoPedido erros={erros} />
        ) : previa ? (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <KpiCard label="Linhas" value={previa.linhas.toLocaleString("pt-BR")} hint="cada linha = categoria numa fatura" />
              <KpiCard label="Faturas distintas" value={previa.faturas.toLocaleString("pt-BR")} />
              <KpiCard label="Valor recebido (Cat.)" amount={previa.total} tone="positive" hint="por Data de Crédito" />
              <KpiCard
                label="Sem categoria"
                amount={previa.semCategoriaValor}
                tone={previa.semCategoriaLinhas > 0 ? "negative" : "neutral"}
                sublabel={`${previa.semCategoriaLinhas.toLocaleString("pt-BR")} linha(s)`}
              />
            </KpiStrip>

            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom={frescor.alerta ? "atencao" : "bom"}>{frescor.alerta ? "Atenção" : "Dados em dia"}</Selo>
                <span>{frescor.texto}</span>
              </li>
              {previa.menorData && previa.maiorData ? (
                <li>
                  Datas de crédito neste recorte: {dataBr(previa.menorData)} a {dataBr(previa.maiorData)}.
                </li>
              ) : null}
              {previa.incluiHoje ? <li>O período inclui dias em andamento: o total muda a cada sincronização (a cada 15 minutos).</li> : null}
              {previa.revisadas > 0 ? <li>{previa.revisadas.toLocaleString("pt-BR")} linha(s) revisada(s) manualmente (categoria e valor congelados).</li> : null}
              {previa.linhas === 0 ? <li className="font-medium text-amber-700">Nenhuma linha neste recorte.</li> : null}
              {previa.passaDoTeto ? (
                <li className="font-medium text-red-700">
                  Este recorte passa de {MAX_LINHAS.toLocaleString("pt-BR")} linhas, o máximo por arquivo: reduza o período ou acrescente filtros.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <RodapeDeDownload idForm={ID_FORM} rota="receita" formatoAtual={formatoDe(params)} formatos={["xlsx", "csv"]} nota="O .xlsx abre na aba Cobranças (os dados); as abas de resumo só vêm se você marcar, e o Leia-me (filtros, hora, atualidade) é a última aba. Só é entregue depois de conferido contra o banco." />
      </Card>
    </div>
  );
}
