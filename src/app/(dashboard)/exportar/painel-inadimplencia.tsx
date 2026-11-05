import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { FAIXAS_DE_ATRASO, ROTULO_STATUS, STATUS_DE_DIVIDA, intervaloDaFaixa, lerFiltros } from "@/lib/inadimplencia/dominio";
import { consultarInadimplencia } from "@/lib/inadimplencia/consulta";
import { fraseDeFrescorInad } from "@/lib/exportacao/frescor-texto";
import { contagem } from "@/lib/exportacao/plural";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { GRUPOS_INAD, lerPedidoInadimplencia } from "@/lib/exportacao/pasta-inadimplencia";
import type { Papel } from "@/lib/exportacao/tipos";
import { Atalhos, ErrosDoPedido, Grupo, OpcaoComDescricao, RodapeDeDownload, formatoDe, href } from "./campos";

/**
 * Painel de exportação de INADIMPLENTES (ADR-0035). A prévia usa a MESMA consulta da tela /inadimplentes
 * (`consultarInadimplencia`), então os números que aparecem aqui são, por construção, os da tela com os mesmos filtros.
 */

const ID_FORM = "form-exportar-inadimplencia";

export async function PainelInadimplencia({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  const { pedido, erros } = lerPedidoInadimplencia(params);
  const f = pedido.filtros;
  const hojeKey = todayKey();
  const hoje = keyToUtcDate(hojeKey);

  // Com erro no pedido a prévia não vale; ainda assim a consulta (com filtros neutros) traz a lista de unidades.
  const r = await consultarInadimplencia(erros.length ? lerFiltros({ visao: "cobranca" }) : { ...f, visao: "cobranca", pagina: 1 }, hoje);
  const frescor = fraseDeFrescorInad({ em: r.sincronizacao.em, status: r.sincronizacao.status, erro: r.sincronizacao.erro }, new Date(), papel === "ADMIN");
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const temFiltro = !!(f.de || f.ate || f.q || f.status || f.unidade);

  const base: Array<[string, string]> = [["dataset", "inadimplencia"], ["f", "1"], ["resumos", "1"]];
  const atalhos = [
    { rotulo: "Todas", dica: "Sem filtro nenhum.", url: href(base) },
    ...FAIXAS_DE_ATRASO.map((fx) => {
      const iv = intervaloDaFaixa(fx, hoje);
      return { rotulo: `Atraso: ${fx.rotulo}`, dica: "Pela idade da dívida, contada a partir de hoje.", url: href([...base, ...(iv.de ? ([["de", iv.de]] as Array<[string, string]>) : []), ["ate", iv.ate]]) };
    }),
    { rotulo: "Jurídico", dica: "Cobranças em cobrança jurídica.", url: href([...base, ["status", "juridical"]]) },
    { rotulo: "Protestadas", dica: "Cobranças protestadas.", url: href([...base, ["status", "protested"]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Mesmos filtros da tela.">Inadimplentes</SectionTitle>
        <Atalhos itens={atalhos} />

        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="inadimplencia" />
          <input type="hidden" name="f" value="1" />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="in-de">
                Vencimento de
              </label>
              <input id="in-de" type="date" name="de" defaultValue={iso(f.de)} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="in-ate">
                até
              </label>
              <input id="in-ate" type="date" name="ate" defaultValue={iso(f.ate)} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="in-q">
                Cliente (nome ou ID)
              </label>
              <input id="in-q" name="q" defaultValue={f.q} placeholder="parte do nome" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="in-status">
                Situação
              </label>
              <select id="in-status" name="status" defaultValue={f.status ?? ""} className="input">
                <option value="">todas</option>
                {STATUS_DE_DIVIDA.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS[s]}
                  </option>
                ))}
              </select>
            </div>
            {r.unidades.length > 1 ? (
              <div>
                <label className="label" htmlFor="in-unidade">
                  Unidade
                </label>
                <select id="in-unidade" name="unidade" defaultValue={f.unidade ?? ""} className="input">
                  <option value="">todas</option>
                  {r.unidades.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className="label" htmlFor="in-ordem">
                Ordenar por
              </label>
              <select id="in-ordem" name="ordem" defaultValue={f.ordem} className="input">
                <option value="valor">Valor</option>
                <option value="vencimento">Vencimento</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="in-dir">
                Direção
              </label>
              <select id="in-dir" name="dir" defaultValue={f.direcao} className="input">
                <option value="desc">{f.ordem === "valor" ? "Maior primeiro" : "Mais recente primeiro"}</option>
                <option value="asc">{f.ordem === "valor" ? "Menor primeiro" : "Mais antigo primeiro"}</option>
              </select>
            </div>
          </div>

          <Grupo legenda="O que vai no arquivo">
            <div className="flex flex-col gap-2">
              {GRUPOS_INAD.map((g) => {
                const bloqueado = g.somenteAdmin && papel !== "ADMIN";
                return (
                  <OpcaoComDescricao
                    key={g.id}
                    id={`in-grupo-${g.id}`}
                    nome="grupos"
                    valor={g.id}
                    rotulo={g.rotulo}
                    descricao={g.descricao}
                    marcado={g.fixo ? true : pedido.grupos.includes(g.id)}
                    desabilitado={g.fixo || bloqueado}
                    nota={g.fixo ? "(sempre)" : bloqueado ? "— somente administrador" : undefined}
                  />
                );
              })}
              <OpcaoComDescricao
                id="in-resumos"
                nome="resumos"
                valor="1"
                rotulo="Abas de resumo"
                descricao="Faixas de atraso, por situação e por unidade (a aba Por cliente sempre vai)."
                marcado={pedido.resumos}
              />
            </div>
          </Grupo>

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <a href="/exportar?dataset=inadimplencia" className="ml-3 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </a>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle hint="do recorte aplicado acima">Prévia do arquivo</SectionTitle>
        {erros.length > 0 ? (
          <ErrosDoPedido erros={erros} />
        ) : (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <KpiCard label="Total em atraso" amount={r.totais.valor} tone="negative" sublabel={temFiltro ? `de ${r.geral.valor} no geral` : undefined} hint="com juros e multa" />
              <KpiCard label="Cobranças" value={r.totais.cobrancas.toLocaleString("pt-BR")} sublabel={temFiltro ? `de ${r.geral.cobrancas.toLocaleString("pt-BR")} no geral` : undefined} />
              <KpiCard label="Clientes" value={r.totais.clientes.toLocaleString("pt-BR")} sublabel={temFiltro ? `de ${r.geral.clientes.toLocaleString("pt-BR")} no geral` : undefined} />
              <KpiCard label="Maior atraso" value={contagem(r.totais.maiorAtraso, "dia", "dias")} />
            </KpiStrip>
            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom={frescor.alerta ? "atencao" : "bom"}>{frescor.alerta ? "Atenção" : "Dados em dia"}</Selo>
                <span>{frescor.texto}</span>
              </li>
              <li>Cobranças renegociadas não entram (a dívida passa para a cobrança nova); o valor inclui juros e multa. Os dias de atraso são contados até hoje.</li>
              {r.totais.cobrancas === 0 ? <li className="font-medium text-amber-700">Nenhuma cobrança neste recorte.</li> : null}
            </ul>
          </div>
        )}

        <RodapeDeDownload idForm={ID_FORM} rota="inadimplencia" formatoAtual={formatoDe(params)} formatos={["xlsx", "csv"]} nota="Sai sem paginação (a tela mostra 50 por página). Telefone e e-mail só para administrador." />
      </Card>
    </div>
  );
}
