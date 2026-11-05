import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { prisma } from "@/lib/db";
import { getPeriodBounds, shiftPeriodKey, todayKey } from "@/lib/dates";
import { frescorDaReceita } from "@/lib/exportacao/frescor";
import { contagem } from "@/lib/exportacao/plural";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { erroDeCategoriasDesconhecidas, LIMITE_VINCULOS_LENTO, lerPedidoClickUp, rotuloDoMes } from "@/lib/exportacao/pasta-clickup";
import { dataHoraBr } from "@/lib/exportacao/planilha";
import type { Papel } from "@/lib/exportacao/tipos";
import { Caixa, ErrosDoPedido, OpcaoComDescricao, RodapeDeDownload, formatoDe, href, mesPorExtenso } from "./campos";

/**
 * Painel de exportação do ESPELHO DO CLICKUP (ADR-0035): vínculos, composição (quais faturas somam o valor de cada
 * tarefa) e envios de UM mês. Só administrador.
 *
 * A prévia é BARATA de propósito: conta vínculos e envios, mas NÃO calcula a composição — ela faz uma consulta por
 * vínculo e só roda ao gerar o arquivo (onde é conferida contra o banco).
 */

const ID_FORM = "form-exportar-clickup";
const pad2 = (n: number) => String(n).padStart(2, "0");
const NOMES_DOS_MESES = Array.from({ length: 12 }, (_, i) => rotuloDoMes(2026, i + 1).split(" de ")[0]!);

export async function PainelClickUp({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  // Defesa em profundidade: a página já esconde o conjunto de quem não é administrador, e o servidor recusa de novo.
  if (papel !== "ADMIN") {
    return (
      <Card>
        <SectionTitle>ClickUp</SectionTitle>
        <p className="text-sm text-slate-600">Este conjunto de dados é restrito a administradores.</p>
      </Card>
    );
  }

  const hojeKey = todayKey();
  const anoAtual = Number(hojeKey.slice(0, 4));
  const { pedido, erros: errosDeLeitura } = lerPedidoClickUp(params, hojeKey);

  const todos = await prisma.clickUpVinculo.findMany({ select: { categoria: true, ativo: true } });
  const categorias = [...new Set(todos.map((v) => v.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const erros = [...errosDeLeitura, ...erroDeCategoriasDesconhecidas(pedido, categorias)];

  const noRecorte = todos.filter((v) => pedido.categorias.length === 0 || pedido.categorias.includes(v.categoria));
  const ativos = noRecorte.filter((v) => v.ativo).length;
  const naComposicao = pedido.somenteAtivos ? ativos : noRecorte.length;

  const doRecorte = pedido.categorias.length ? { vinculo: { categoria: { in: pedido.categorias } } } : {};
  const [frescor, porSucesso, ultimoEnvio] = await Promise.all([
    frescorDaReceita(new Date()),
    erros.length
      ? Promise.resolve([])
      : prisma.clickUpPushLog.groupBy({ by: ["sucesso"], where: { ano: pedido.ano, mes: pedido.mes, ...doRecorte }, _count: { _all: true } }),
    erros.length ? Promise.resolve(null) : prisma.clickUpPushLog.findFirst({ where: doRecorte, orderBy: { enviadoEm: "desc" }, select: { enviadoEm: true, sucesso: true } }),
  ]);
  const enviosOk = porSucesso.find((g) => g.sucesso)?._count._all ?? 0;
  const enviosFalha = porSucesso.find((g) => !g.sucesso)?._count._all ?? 0;

  const mesPedido = `${pedido.ano}-${pad2(pedido.mes)}`;
  const mesDeHoje = hojeKey.slice(0, 7);
  const anos = [anoAtual - 3, anoAtual - 2, anoAtual - 1, anoAtual];
  if (!anos.includes(pedido.ano)) anos.push(pedido.ano);
  anos.sort((a, b) => b - a);

  const mesAnterior = shiftPeriodKey(getPeriodBounds("month").fromKey, "month", -1).slice(0, 7);
  const base: Array<[string, string]> = [["dataset", "clickup"], ["f", "1"], ["somenteAtivos", "1"]];
  const atalhos = [
    { rotulo: "Mês atual", dica: "O mês que o painel está enviando ao ClickUp agora.", url: href([...base, ["ano", mesDeHoje.slice(0, 4)], ["mes", String(Number(mesDeHoje.slice(5, 7)))]]) },
    { rotulo: "Mês anterior", dica: mesPorExtenso(mesAnterior), url: href([...base, ["ano", mesAnterior.slice(0, 4)], ["mes", String(Number(mesAnterior.slice(5, 7)))]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Espelho da receita, por mês.">ClickUp: vínculos, composição e envios</SectionTitle>

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
          <input type="hidden" name="dataset" value="clickup" />
          <input type="hidden" name="f" value="1" />

          <fieldset>
            <legend className="label">Mês de apuração — Data de Crédito da Cobrança (o mesmo critério do envio ao ClickUp)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ck-mes">
                  Mês
                </label>
                <select id="ck-mes" name="mes" defaultValue={String(pedido.mes)} className="input">
                  {NOMES_DOS_MESES.map((nome, i) => (
                    <option key={nome} value={i + 1}>
                      {nome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ck-ano">
                  Ano
                </label>
                <select id="ck-ano" name="ano" defaultValue={String(pedido.ano)} className="input">
                  {anos.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <details open={pedido.categorias.length > 0} className="rounded-lg border border-slate-200/80 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-slate-700">
              Categoria{pedido.categorias.length ? ` — ${pedido.categorias.length} selecionada(s)` : " — todas as que têm vínculo"}
            </summary>
            <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {categorias.map((c) => (
                <Caixa key={c} nome="categoria" valor={c} rotulo={c} marcado={pedido.categorias.includes(c)} />
              ))}
            </div>
          </details>

          <OpcaoComDescricao
            id="ck-ativos"
            nome="somenteAtivos"
            valor="1"
            rotulo="Somente vínculos ativos"
            descricao="Só os vínculos que o painel de fato envia entram na composição. Os inativos aparecem na aba Vínculos; desmarcar inclui a composição deles (hipotética: o que somariam se estivessem ativos)."
            marcado={pedido.somenteAtivos}
          />

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <Link href="/exportar?dataset=clickup" className="ml-3 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </Link>
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
              <KpiCard label="Vínculos no recorte" value={noRecorte.length.toLocaleString("pt-BR")} sublabel={`${contagem(ativos, "ativo", "ativos")} · ${contagem(noRecorte.length - ativos, "inativo", "inativos")}`} />
              <KpiCard label="Entram na composição" value={naComposicao.toLocaleString("pt-BR")} hint="uma consulta por vínculo ao gerar" />
              <KpiCard
                label={`Envios em ${rotuloDoMes(pedido.ano, pedido.mes).toLowerCase()}`}
                value={(enviosOk + enviosFalha).toLocaleString("pt-BR")}
                tone={enviosFalha > 0 ? "negative" : "neutral"}
                sublabel={`${enviosFalha.toLocaleString("pt-BR")} com falha`}
              />
              <KpiCard
                label="Último envio (qualquer mês)"
                value={ultimoEnvio ? dataHoraBr(ultimoEnvio.enviadoEm) : "nunca"}
                tone={ultimoEnvio && !ultimoEnvio.sucesso ? "negative" : "neutral"}
                sublabel={ultimoEnvio ? (ultimoEnvio.sucesso ? "com sucesso" : "FALHOU") : undefined}
              />
            </KpiStrip>

            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom={frescor.alerta ? "atencao" : "bom"}>{frescor.alerta ? "Atenção" : "Dados em dia"}</Selo>
                <span>{frescor.texto}</span>
              </li>
              <li>
                A composição (quais faturas somam o valor de cada tarefa) é calculada na hora de gerar o arquivo, pela mesma regra do envio ao ClickUp, e só é entregue depois de conferida contra o banco. O histórico de envios guarda só o total:
                a planilha mostra a diferença entre o total de hoje e o último valor enviado.
              </li>
              {mesPedido === mesDeHoje ? (
                <li>O mês está em andamento: a composição muda a cada sincronização (a cada 15 minutos).</li>
              ) : mesPedido < mesDeHoje ? (
                <li>Mês encerrado: o painel só envia o mês corrente, então a diferença para o último envio não se corrige sozinha.</li>
              ) : (
                <li>Este mês ainda não começou: não há receita a compor.</li>
              )}
              {naComposicao > LIMITE_VINCULOS_LENTO ? (
                <li className="font-medium text-amber-700">
                  Este recorte calcula {naComposicao.toLocaleString("pt-BR")} composições (uma consulta por vínculo): a geração pode levar alguns segundos. Filtrar por categoria acelera.
                </li>
              ) : null}
              {noRecorte.length === 0 ? <li className="font-medium text-amber-700">Nenhum vínculo neste recorte.</li> : null}
            </ul>
          </div>
        )}

        <RodapeDeDownload
          idForm={ID_FORM}
          rota="clickup" formatoAtual={formatoDe(params)}
          formatos={["xlsx", "csv"]}
          nota="O .xlsx abre na aba Composição e leva também Vínculos, Resumo por vínculo, Excluídas e Envios, com o Leia-me por último. Só é entregue depois de conferido contra o banco."
        />
      </Card>
    </div>
  );
}
