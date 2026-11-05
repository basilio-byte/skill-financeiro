import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { Selo } from "@/components/selo";
import { listarConflitos } from "@/lib/categorization/conflitos";
import { toAmountString } from "@/lib/money";
import { frescorDaReceita } from "@/lib/exportacao/frescor";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { CLASSIFICACOES, INFO_CLASSIFICACAO, filtrarPorClassificacao, lerPedidoConflitos, resumirConflitos, rotuloClassificacao } from "@/lib/exportacao/pasta-conflitos";
import { MAX_LINHAS, type Papel } from "@/lib/exportacao/tipos";
import { Atalhos, ErrosDoPedido, Grupo, OpcaoComDescricao, RodapeDeDownload, formatoDe, href } from "./campos";

/**
 * Painel de exportação de CONFLITOS (ADR-0035). A prévia usa a MESMA lista da tela /conflitos (`listarConflitos`), então
 * os números daqui são, por construção, os da tela. Só administrador: a tela de origem também é, e a planilha traz o nome
 * do cliente e de quem revisou cada linha.
 */

const ID_FORM = "form-exportar-conflitos";

const nPt = (n: number): string => n.toLocaleString("pt-BR");

export async function PainelConflitos({ params, papel }: { params: ParamsBrutos; papel: Papel }) {
  // Defesa em profundidade: nem lê a lista para quem não é administrador (a rota de download recusa com 403 de qualquer forma).
  if (papel !== "ADMIN") {
    return (
      <Card>
        <SectionTitle hint="Somente administrador.">Conflitos</SectionTitle>
        <p className="text-sm text-slate-600">A lista de conflitos só pode ser exportada por administradores.</p>
      </Card>
    );
  }

  const { pedido, erros } = lerPedidoConflitos(params);
  const [todos, frescor] = await Promise.all([listarConflitos(), frescorDaReceita(new Date())]);
  const geral = resumirConflitos(todos);
  // Com erro no pedido a prévia não vale (e o filtro, malformado, não deve valer em silêncio).
  const selecionados = erros.length ? [] : filtrarPorClassificacao(todos, pedido.classificacoes);
  const r = resumirConflitos(selecionados);
  const filtrado = pedido.classificacoes.length > 0;

  const base: Array<[string, string]> = [["dataset", "conflitos"], ["f", "1"], ["resumos", "1"]];
  const atalhos = [
    { rotulo: "Todos", dica: "Todas as classificações.", url: href(base) },
    {
      rotulo: "Resolvíveis com um clique",
      dica: "Duplicata em Sem Categoria e revisão manual superada: a tela Conflitos resolve com um botão.",
      url: href([...base, ["classificacao", "duplicata_sem_categoria"], ["classificacao", "manual_superada"]]),
    },
    { rotulo: "Precisam de decisão manual", dica: "Ambíguos: a pessoa confere os valores e exclui a linha errada.", url: href([...base, ["classificacao", "ambiguo"]]) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="A mesma lista da tela Conflitos.">Faturas com possível dupla contagem</SectionTitle>
        <Atalhos itens={atalhos} />

        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="conflitos" />
          <input type="hidden" name="f" value="1" />

          <Grupo legenda="Classificação" dica="Nenhuma marcada = todas.">
            <div className="flex flex-col gap-2">
              {CLASSIFICACOES.map((t) => (
                <OpcaoComDescricao
                  key={t}
                  id={`cf-classificacao-${t}`}
                  nome="classificacao"
                  valor={t}
                  rotulo={rotuloClassificacao(t)}
                  descricao={INFO_CLASSIFICACAO[t].significado}
                  marcado={pedido.classificacoes.includes(t)}
                  nota={`(${nPt(geral.porClassificacao[t].conflitos)} em aberto)`}
                />
              ))}
            </div>
          </Grupo>

          <Grupo legenda="O que vai no arquivo">
            <div className="flex flex-col gap-2">
              <OpcaoComDescricao
                id="cf-resumos"
                nome="resumos"
                valor="1"
                rotulo="Abas de resumo"
                descricao="Por fatura (uma linha por conflito) e Por classificação (quantas faturas e quanto em diferença). A aba Conflitos, com uma linha por linha de cada fatura, sempre vai."
                marcado={pedido.resumos}
              />
            </div>
          </Grupo>

          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
            <a href="/exportar?dataset=conflitos" className="ml-3 text-sm text-acento-texto hover:underline">
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
              <KpiCard
                label="Faturas em conflito"
                value={nPt(r.conflitos)}
                sublabel={`${nPt(r.linhas)} linha(s)${filtrado ? ` · de ${nPt(geral.conflitos)} no geral` : ""}`}
                tone={r.conflitos > 0 ? "negative" : "positive"}
                hint="fatura × mês de crédito"
              />
              <KpiCard label="Excesso" amount={toAmountString(r.excesso)} tone={r.conflitosComExcesso > 0 ? "negative" : "neutral"} sublabel={`${nPt(r.conflitosComExcesso)} conflito(s)`} hint="linhas somam mais que a fatura" />
              <KpiCard label="Falta" amount={toAmountString(r.falta)} sublabel={`${nPt(r.conflitosComFalta)} conflito(s)`} hint="linhas somam menos que a fatura" />
              <KpiCard label="Soma das linhas (Valor Cat.)" amount={toAmountString(r.somaAtual)} hint="a coluna que soma na planilha" />
            </KpiStrip>

            <ul className="flex flex-col gap-1.5 text-[13px] text-slate-600">
              <li className="flex flex-wrap items-center gap-2">
                <Selo tom={frescor.alerta ? "atencao" : "bom"}>{frescor.alerta ? "Atenção" : "Dados em dia"}</Selo>
                <span>{frescor.texto}</span>
              </li>
              <li>A lista é calculada na hora e reflete o estado atual do banco, como na tela Conflitos: conflito resolvido depois some, e a cada sincronização podem surgir outros.</li>
              {r.conflitos > 0 ? (
                <li>{CLASSIFICACOES.map((t) => `${rotuloClassificacao(t)}: ${nPt(r.porClassificacao[t].conflitos)}`).join(" · ")}.</li>
              ) : null}
              {r.conflitosComFalta > 0 ? (
                <li>
                  {r.conflitosComFalta === 1 ? "1 conflito tem" : `${nPt(r.conflitosComFalta)} conflitos têm`} diferença NEGATIVA (as linhas somam menos que a fatura): não é dupla contagem, é falta de valor — confira a fatura antes de excluir qualquer linha.
                </li>
              ) : null}
              {r.conflitos === 0 ? (
                <li className={todos.length === 0 ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                  {todos.length === 0 ? "Nenhum conflito em aberto: a planilha sai só com os cabeçalhos (serve de comprovante)." : "Nenhum conflito neste recorte."}
                </li>
              ) : null}
              {r.linhas > MAX_LINHAS ? (
                <li className="font-medium text-red-700">
                  Este recorte passa de {nPt(MAX_LINHAS)} linhas, o máximo por arquivo: peça uma classificação por vez.
                </li>
              ) : null}
            </ul>
          </div>
        )}

        <RodapeDeDownload
          idForm={ID_FORM}
          rota="conflitos" formatoAtual={formatoDe(params)}
          formatos={["xlsx", "csv"]}
          nota="O .xlsx traz as abas Leia-me (o que cada classificação significa e o que fazer), Conflitos (uma linha por linha de cada fatura), Por fatura e Por classificação, e só é entregue depois de conferido."
        />
      </Card>
    </div>
  );
}
