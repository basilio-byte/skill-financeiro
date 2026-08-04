/**
 * Quem morre e quem vive na limpeza de órfãs (ADR-0029).
 *
 * Puro de propósito: este é o trecho mais perigoso do sistema — ele APAGA linhas
 * de receita — e até esta correção não havia UM teste que o exercitasse. A
 * revisão adversarial achou dois bugs CRÍTICOS na primeira versão, ambos porque
 * a decisão era escopada pela JANELA DA RODADA em vez da verdade do Conexa:
 *
 *  1. Janela cruzando dois meses (01/07–31/08) APAGAVA o mês que a rodada não
 *     emitiu. A rodada só consegue emitir UMA parcela por fatura, então a linha
 *     do outro mês parecia órfã. E isso é um clique do produto: "Aplicar agora"
 *     em /categorias monta a janela de min a max das datas de crédito.
 *  2. Data corrigida de julho para agosto no Conexa deixava a linha de julho
 *     inalcançável para sempre — os dois meses contavam a mesma receita.
 *
 * A regra abaixo não olha a janela para decidir sobre um mês que a fatura ainda
 * reconhece. Ela pergunta ao Conexa: **este mês ainda está na lista de datas de
 * crédito da fatura?**
 */

/** O mínimo que a decisão precisa saber de uma linha já gravada. */
export interface LinhaExistente {
  id: string;
  crConexaId: number;
  chaveLinha: string;
  mesCredito: string;
  revisadoManualmente: boolean;
}

export interface DecisaoOrfas {
  /** Linhas a APAGAR — nunca inclui revisada manualmente. */
  idsParaApagar: string[];
  /** Órfãs preservadas por revisão manual, como `crConexaId::mesCredito`. */
  preservadasPorRevisao: string[];
}

export const chaveLinhaCompleta = (crConexaId: number, chaveLinha: string, mesCredito: string) =>
  `${crConexaId}::${chaveLinha}::${mesCredito}`;

/**
 * @param existentes             linhas já no banco que a rodada alcançou
 * @param chavesProduzidas       identidades que ESTA rodada acabou de gravar
 * @param mesesValidosPorFatura  meses da lista de Data Crédito de cada fatura
 *                               que apareceu nesta rodada (verdade do Conexa)
 * @param mesesDaRodada          meses cobertos pela janela desta rodada
 */
export function decidirOrfas(
  existentes: LinhaExistente[],
  chavesProduzidas: Set<string>,
  mesesValidosPorFatura: Map<number, Set<string>>,
  mesesDaRodada: string[],
  mesesProduzidosPorFatura: Map<number, Set<string>>,
): DecisaoOrfas {
  const idsParaApagar: string[] = [];
  const preservadasPorRevisao: string[] = [];

  for (const e of existentes) {
    // 1. A rodada acabou de gravar esta linha. Viva, obviamente.
    if (chavesProduzidas.has(chaveLinhaCompleta(e.crConexaId, e.chaveLinha, e.mesCredito))) continue;

    const mesesValidos = mesesValidosPorFatura.get(e.crConexaId);

    let condenada: boolean;
    if (mesesProduzidosPorFatura.get(e.crConexaId)?.has(e.mesCredito)) {
      // 2. A rodada PRODUZIU linha para esta fatura NESTE mês, e esta linha não
      //    está entre as produzidas. Dentro de um mês que a rodada cobriu, ela é
      //    autoridade: é a órfã clássica (o bucket mudou de categoria porque a
      //    skill passou a mapear o serviço). Tem de sair, senão a fatura conta
      //    duas vezes no mesmo mês. Este caso foi pego por um teste próprio
      //    depois que a primeira versão da regra o deixou passar.
      condenada = true;
    } else if (mesesValidos && mesesValidos.size > 0) {
      // 3. A rodada NÃO cobriu este mês (emitiu outra parcela da mesma fatura).
      //    Só condena se o mês sumiu da lista de Data Crédito do Conexa. Se
      //    continua lá, é parcela legítima que esta rodada não tinha como
      //    representar — apagá-la era o bug crítico nº 1.
      condenada = !mesesValidos.has(e.mesCredito);
    } else {
      // 3. A fatura NÃO veio nesta rodada (sumiu do resultado: status mudou,
      //    data saiu do período — o caso da ADR-0020), ou veio sem lista de
      //    datas legível. Aqui não temos a verdade do Conexa sobre ela, então
      //    só podemos julgar o que está DENTRO da nossa janela. Fora dela,
      //    silêncio: outra rodada, do mês certo, é quem decide.
      condenada = mesesDaRodada.includes(e.mesCredito);
    }

    if (!condenada) continue;

    // Revisão manual nunca é apagada em silêncio (financial-rigor #9).
    if (e.revisadoManualmente) preservadasPorRevisao.push(`${e.crConexaId}::${e.mesCredito}`);
    else idsParaApagar.push(e.id);
  }

  return { idsParaApagar, preservadasPorRevisao };
}
