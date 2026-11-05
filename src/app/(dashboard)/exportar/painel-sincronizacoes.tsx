import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { APP_TZ, getPeriodBounds, shiftPeriodKey, todayKey } from "@/lib/dates";
import { frescorDaReceita } from "@/lib/exportacao/frescor";
import { haQuanto } from "@/lib/exportacao/frescor-texto";
import { dataBr, um, type ParamsBrutos } from "@/lib/exportacao/parametros";
import {
  GRUPOS_SINC,
  ORIGENS_SINC,
  ROTULO_ORIGEM_SINC,
  ROTULO_STATUS_SINC,
  STATUS_SINC,
  lerPedidoSincronizacoes,
  periodoPadraoDaTela,
  somarDias,
} from "@/lib/exportacao/pasta-sincronizacoes";
import { previaSincronizacoes } from "@/lib/exportacao/sincronizacoes";
import { MAX_LINHAS, type Papel } from "@/lib/exportacao/tipos";
import { Atalhos, Caixa, ErrosDoPedido, Grupo, OpcaoComDescricao, RodapeDeDownload, formatoDe, href, mesPorExtenso } from "./campos";

/**
 * Painel de exportação do HISTÓRICO DE SINCRONIZAÇÕES de receita (ADR-0035): filtros → prévia → download.
 *
 * Tudo por GET e sem JavaScript, como os demais painéis: o estado vive na URL. A prévia conta o que o MESMO filtro do
 * arquivo vai entregar (`condicaoSincronizacoes`), então os números daqui são, por construção, os do arquivo.
 */

const ID_FORM = "form-exportar-sincronizacoes";

/** "04/11 17:00" no fuso do app — curto o bastante para caber num indicador. */
const horaCurta = (d: Date): string =>
  d.toLocaleString("pt-BR", { timeZone: APP_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");

export async function PainelSincronizacoes({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  const hoje = todayKey();
  const enviado = um(params.f) !== "";
  const semDatas = um(params.de) === "" && um(params.ate) === "";
  // Primeira visita (sem formulário enviado nem datas): os últimos 30 dias, o pedido típico. A API, ao contrário, não
  // assume período: um download sem datas pede o histórico inteiro. Com o formulário enviado e as datas em branco, vale o branco.
  const abriuNoPadrao = !enviado && semDatas;
  const efetivos: ParamsBrutos = abriuNoPadrao ? { ...params, ...periodoPadraoDaTela(hoje) } : params;
  const { pedido, erros } = lerPedidoSincronizacoes(efetivos);

  const [previa, frescor] = erros.length ? [null, null] : await Promise.all([previaSincronizacoes(pedido), frescorDaReceita(new Date())]);

  const base: Array<[string, string]> = [["dataset", "sincronizacoes"], ["f", "1"], ["resumos", "1"]];
  const de7 = somarDias(hoje, -6);
  const de30 = somarDias(hoje, -29);
  const mesAtual = getPeriodBounds("month");
  const mesAnterior = getPeriodBounds("month", shiftPeriodKey(mesAtual.fromKey, "month", -1));
  const atalhos = [
    { rotulo: "Últimos 7 dias", dica: `${dataBr(de7)} a ${dataBr(hoje)}`, url: href([...base, ["de", de7], ["ate", hoje]]) },
    { rotulo: "Últimos 30 dias", dica: `${dataBr(de30)} a ${dataBr(hoje)}`, url: href([...base, ["de", de30], ["ate", hoje]]) },
    { rotulo: "Mês atual", dica: `Do dia 1 até hoje: ${mesPorExtenso(mesAtual.fromKey.slice(0, 7))}.`, url: href([...base, ["de", mesAtual.fromKey], ["ate", hoje]]) },
    { rotulo: "Mês anterior", dica: mesPorExtenso(mesAnterior.fromKey.slice(0, 7)), url: href([...base, ["de", mesAnterior.fromKey], ["ate", mesAnterior.toKey]]) },
    { rotulo: "Falhas (30 dias)", dica: "Só as rodadas que falharam, nos últimos 30 dias.", url: href([...base, ["de", de30], ["ate", hoje], ["status", "FAILED"]]) },
    { rotulo: "Importações manuais", dica: "Todas as importações de arquivos, sem filtro de data.", url: href([...base, ["origem", "IMPORTACAO"]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Rodadas de sincronização.">Sincronizações de receita</SectionTitle>
        <Atalhos itens={atalhos} />

        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="sincronizacoes" />
          <input type="hidden" name="f" value="1" />

          <fieldset>
            <legend className="label">Período — início da rodada (horário de Fortaleza, UTC−3)</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label" htmlFor="sc-de">
                  De
                </label>
                <input id="sc-de" type="date" name="de" defaultValue={pedido.de ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="sc-ate">
                  até (inclusive)
                </label>
                <input id="sc-ate" type="date" name="ate" defaultValue={pedido.ate ?? ""} className="input" />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {abriuNoPadrao ? `Abriu nos últimos 30 dias (${dataBr(de30)} a ${dataBr(hoje)}). ` : ""}
              Deixe as datas em branco para exportar todo o histórico, até {MAX_LINHAS.toLocaleString("pt-BR")} rodadas por arquivo.
            </p>
          </fieldset>

          <div className="grid gap-5 lg:grid-cols-2">
            <Grupo legenda="Origem" dica="Nenhuma marcada = todas.">
              {ORIGENS_SINC.map((o) => (
                <Caixa key={o} nome="origem" valor={o} rotulo={ROTULO_ORIGEM_SINC[o]} marcado={pedido.origens.includes(o)} />
              ))}
            </Grupo>
            <Grupo legenda="Status" dica="Nenhum marcado = todos.">
              {STATUS_SINC.map((s) => (
                <Caixa key={s} nome="status" valor={s} rotulo={ROTULO_STATUS_SINC[s]} marcado={pedido.status.includes(s)} />
              ))}
            </Grupo>
          </div>

          <Grupo legenda="O que vai no arquivo">
            <div className="flex flex-col gap-2">
              {GRUPOS_SINC.map((g) => {
                const bloqueado = g.somenteAdmin && papel !== "ADMIN";
                return (
                  <OpcaoComDescricao
                    key={g.id}
                    id={`sc-grupo-${g.id}`}
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
                id="sc-resumos"
                nome="resumos"
                valor="1"
                rotulo="Abas de resumo"
                descricao="Por origem e status, e por dia (rodadas, concluídas, falhas e a hora da última concluída: ajuda a achar o dia em que a sincronização parou)."
                marcado={pedido.resumos}
              />
            </div>
          </Grupo>

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <a href="/exportar?dataset=sincronizacoes" className="ml-3 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </a>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle hint="do recorte aplicado acima">Prévia do arquivo</SectionTitle>
        {erros.length > 0 ? (
          <ErrosDoPedido erros={erros} />
        ) : previa && frescor ? (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <KpiCard label="Rodadas" value={previa.rodadas.toLocaleString("pt-BR")} hint="uma linha por rodada" />
              <KpiCard label="Concluídas" value={previa.concluidas.toLocaleString("pt-BR")} />
              <KpiCard label="Falharam" value={previa.falhas.toLocaleString("pt-BR")} tone={previa.falhas > 0 ? "negative" : "neutral"} />
              <KpiCard
                label="Última concluída"
                value={previa.ultimaConcluidaEm ? horaCurta(previa.ultimaConcluidaEm) : "—"}
                hint={previa.ultimaConcluidaEm ? `há ${haQuanto(Math.max(0, Math.floor((Date.now() - previa.ultimaConcluidaEm.getTime()) / 60_000)))}` : "nenhuma neste recorte"}
              />
            </KpiStrip>

            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom={frescor.alerta ? "atencao" : "bom"}>{frescor.alerta ? "Atenção" : "Dados em dia"}</Selo>
                <span>{frescor.texto}</span>
              </li>
              <li>
                O “Total recebido” de uma rodada é o que ELA calculou na hora: não se soma entre rodadas (a sincronização automática recalcula o mesmo período a cada vez). Por isso o arquivo não traz total em dinheiro.
              </li>
              {previa.emAndamento > 0 ? <li>{previa.emAndamento.toLocaleString("pt-BR")} rodada(s) em andamento agora: saem como “Sincronizando”, sem conclusão nem duração.</li> : null}
              {previa.outroStatus > 0 ? <li>{previa.outroStatus.toLocaleString("pt-BR")} rodada(s) com status fora do padrão: saem como vieram.</li> : null}
              {previa.rodadas === 0 ? <li className="font-medium text-amber-700">Nenhuma rodada neste recorte.</li> : null}
              {previa.passaDoTeto ? (
                <li className="font-medium text-red-700">
                  Este recorte passa de {MAX_LINHAS.toLocaleString("pt-BR")} rodadas, o máximo por arquivo: reduza o período ou filtre por origem e status.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <RodapeDeDownload
          idForm={ID_FORM}
          rota="sincronizacoes" formatoAtual={formatoDe(params)}
          formatos={["xlsx", "csv"]}
          nota="O .xlsx leva as abas Leia-me, Rodadas, Por origem e status e Por dia, e só é entregue depois de conferido contra o banco."
        />
      </Card>
    </div>
  );
}
