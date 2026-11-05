import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { comInicialMaiuscula, getPeriodBounds, shiftPeriodKey, todayKey } from "@/lib/dates";
import { previaAcessos } from "@/lib/exportacao/acessos";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { ABAS_ACESSOS, IDS_ABAS_ACESSOS, lerPedidoAcessos } from "@/lib/exportacao/pasta-acessos";
import { MAX_LINHAS, type Papel } from "@/lib/exportacao/tipos";
import { Atalhos, ErrosDoPedido, Grupo, OpcaoComDescricao, RodapeDeDownload, formatoDe, href } from "./campos";

/**
 * Painel de exportação de CONTAS, ACESSOS e AUDITORIA (ADR-0035) — só administrador. Formulário GET (o estado vive na
 * URL), prévia por aba com as MESMAS condições da exportação (`previaAcessos`) e o download pelo rodapé comum.
 *
 * Tudo aqui é dado pessoal (e-mail, IP, navegador): este componente se recusa a consultar o banco para quem não é
 * administrador, mesmo que a página o renderize por engano — a página já esconde o conjunto, a rota e o gerador
 * conferem de novo, e esta é mais uma camada.
 */

const ID_FORM = "form-exportar-acessos";

const n = (x: number): string => x.toLocaleString("pt-BR");

export async function PainelAcessos({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  if (papel !== "ADMIN") {
    return (
      <Card>
        <SectionTitle>Contas e acessos</SectionTitle>
        <p role="alert" className="text-sm text-red-700">
          Somente administradores exportam contas, acessos e auditoria: são dados pessoais (e-mails, IPs e navegadores).
        </p>
      </Card>
    );
  }

  const { pedido, erros } = lerPedidoAcessos(params);
  // Com erro no pedido a prévia não vale (e não há o que contar com um recorte inválido).
  const previa = erros.length ? null : await previaAcessos(pedido, papel);

  const hoje = todayKey();
  const mesAtual = getPeriodBounds("month");
  const mesAnterior = getPeriodBounds("month", shiftPeriodKey(mesAtual.fromKey, "month", -1));
  const base: Array<[string, string]> = [["dataset", "acessos"], ["f", "1"]];
  const todas: Array<[string, string]> = IDS_ABAS_ACESSOS.map((id) => ["abas", id]);
  const comPeriodo = (de: string, ate: string): string => href([...base, ...todas, ["de", de], ["ate", ate]]);
  const atalhos = [
    { rotulo: "Tudo", dica: "Todas as abas, todo o histórico (sem datas).", url: href([...base, ...todas]) },
    { rotulo: "Últimos 7 dias", dica: "Eventos dos últimos 7 dias, hoje incluído.", url: comPeriodo(shiftPeriodKey(hoje, "day", -6), hoje) },
    { rotulo: "Últimos 30 dias", dica: "Eventos dos últimos 30 dias, hoje incluído.", url: comPeriodo(shiftPeriodKey(hoje, "day", -29), hoje) },
    { rotulo: "Mês atual", dica: "Do dia 1 até hoje.", url: comPeriodo(mesAtual.fromKey, hoje) },
    { rotulo: "Mês anterior", dica: comInicialMaiuscula(mesAnterior.label), url: comPeriodo(mesAnterior.fromKey, mesAnterior.toKey) },
    { rotulo: "Só contas e tokens", dica: "O estado de agora, sem eventos (as datas não se aplicam).", url: href([...base, ["abas", "contas"], ["abas", "tokens"]]) },
    { rotulo: "Só logins", dica: "As tentativas de login.", url: href([...base, ["abas", "acessos"]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Somente administrador.">Contas, acessos e auditoria</SectionTitle>
        <Atalhos itens={atalhos} />

        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="acessos" />
          <input type="hidden" name="f" value="1" />

          <fieldset>
            <legend className="label">Período dos eventos — horário de Fortaleza (UTC−3)</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label" htmlFor="ac-de">
                  De
                </label>
                <input id="ac-de" type="date" name="de" defaultValue={pedido.de ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="ac-ate">
                  até (o dia inteiro entra)
                </label>
                <input id="ac-ate" type="date" name="ate" defaultValue={pedido.ate ?? ""} className="input" />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Vale para Acessos, Auditoria do MCP e Exportações. Contas e Tokens do MCP mostram o estado de agora e não são filtradas por data.
            </p>
          </fieldset>

          <Grupo legenda="O que vai no arquivo" dica="Cada aba marcada vira uma aba da planilha. No CSV sai só a primeira marcada.">
            <div className="flex flex-col gap-2">
              {ABAS_ACESSOS.map((a) => (
                <OpcaoComDescricao
                  key={a.id}
                  id={`ac-aba-${a.id}`}
                  nome="abas"
                  valor={a.id}
                  rotulo={a.rotulo}
                  descricao={a.descricao}
                  marcado={pedido.abas.includes(a.id)}
                  nota={a.evento ? "(filtrada por data)" : "(estado de agora)"}
                />
              ))}
            </div>
          </Grupo>

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <a href="/exportar?dataset=acessos" className="ml-3 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </a>
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
              <KpiCard label="Linhas no arquivo" value={n(previa.totalLinhas)} sublabel={`${n(previa.abas.length)} aba(s) de dados`} hint="soma das abas marcadas" />
              <KpiCard label="Logins" value={previa.acessos ? n(previa.acessos.total) : "—"} sublabel={previa.acessos ? `${n(previa.acessos.falhas)} falha(s)` : "aba não marcada"} />
              <KpiCard label="Chamadas do MCP" value={previa.mcp ? n(previa.mcp.total) : "—"} sublabel={previa.mcp ? `${n(previa.mcp.escritas)} de escrita` : "aba não marcada"} />
              <KpiCard
                label="Exportações registradas"
                value={previa.exportacoes ? n(previa.exportacoes.total) : "—"}
                sublabel={previa.exportacoes ? `${n(previa.exportacoes.comDadosPessoais)} com dados pessoais` : "aba não marcada"}
              />
            </KpiStrip>

            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom="atencao">Dados pessoais</Selo>
                <span>Este arquivo traz e-mails, IPs e navegadores de pessoas. Trate com o cuidado devido (LGPD) e não o encaminhe a quem não precisa.</span>
              </li>
              {previa.abas.map((a) => (
                <li key={a.id}>
                  {a.nome}: {n(a.linhas)} linha(s) ({a.resumo}).
                </li>
              ))}
              <li>Nunca saem: senhas e hashes, tokens do MCP (só o prefixo visível) e os argumentos e o estado anterior das chamadas do MCP.</li>
              {previa.totalLinhas === 0 ? <li className="font-medium text-amber-700">Nenhuma linha neste recorte.</li> : null}
              {previa.acimaDoTeto.map((a) => (
                <li key={a.nome} className="font-medium text-red-700">
                  A aba {a.nome} tem {n(a.linhas)} linhas neste recorte e o máximo por aba é {n(MAX_LINHAS)}: informe datas (de/até) ou desmarque a aba.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <RodapeDeDownload
          idForm={ID_FORM}
          rota="acessos" formatoAtual={formatoDe(params)}
          formatos={["xlsx", "csv"]}
          nota="O .xlsx abre nas abas de dados e leva, por último, um Leia-me com o recorte, a hora e como ler cada aba. Só é entregue depois de conferido contra o banco. Contém dados pessoais: somente administrador. No CSV sai só a primeira aba marcada."
        />
      </Card>
    </div>
  );
}
