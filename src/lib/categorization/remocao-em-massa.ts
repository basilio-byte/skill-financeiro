import { chaveLinhaCompleta } from "@/lib/categorization/orfas";
import { mesDoCreditoOuSentinela } from "@/lib/categorization/mes-credito";
import { formatBRL, formatPercent, money, ZERO, type Money } from "@/lib/money";

/**
 * Freio de segurança da gravação (ADR-0036): uma rodada não pode derrubar, em silêncio, a receita que o painel já
 * tem para o período.
 *
 * Por que existe: em novembro de 2026 o Conexa passou a cortar o export de Contas a Receber em 20 linhas e a rodada
 * gravou esse resultado como verdade — a limpeza de órfãs apagou ~R$ 300 mil de outubro e a rodada terminou
 * "Concluída". A conferência da skill (soma do CR × soma categorizada) não tinha como ver isso: ela compara o
 * arquivo com ele mesmo. A defesa principal agora fica no download (`conexa-web/exports-completos.ts`, que confere
 * o total da grade do Conexa); este freio é a segunda camada, para o defeito que ainda não conhecemos.
 *
 * O que se mede é a QUEDA LÍQUIDA — o total das linhas alcançadas antes × depois de gravar —, não o valor apagado.
 * Recategorizar (regra nova em /categorias, "Aplicar agora") apaga buckets antigos e cria novos com o MESMO
 * dinheiro: o valor apagado é alto e a queda líquida é zero. Medir o apagado travaria essa operação legítima.
 *
 * Puro de propósito (sem banco): `persist.ts` chama dentro da transação, antes do `deleteMany`.
 */

/** Bloqueia quando a queda é de pelo menos 30% do que havia... */
export const LIMITE_QUEDA_PERCENTUAL = 30;
/** ...E de pelo menos R$ 2.000,00 (abaixo disso, um dia fraco no começo do mês travaria por centavos). */
export const LIMITE_QUEDA_VALOR = money("2000.00");

export class RemocaoEmMassaError extends Error {}

/** Linha já gravada que a rodada alcançou (`filtroLinhasAlcancadas`), com o valor que ela conta hoje. */
export interface LinhaGravadaComValor {
  id: string;
  crConexaId: number;
  chaveLinha: string;
  mesCredito: string;
  revisadoManualmente: boolean;
  valorRecebidoCat: Money;
}

/** Linha que a rodada vai gravar (upsert). */
export interface LinhaDaRodadaComValor {
  crId: number;
  chaveLinha: string;
  dataCredito: Date | null;
  valorRecebidoCategoria: Money;
}

export interface AvaliacaoQueda {
  antes: Money;
  depois: Money;
  /** antes − depois (negativo = a receita CRESCE). */
  queda: Money;
  /** Queda em % do que havia (0 quando não havia nada). */
  percentual: number;
  linhasRemovidas: number;
  bloquear: boolean;
}

/**
 * Simula o estado das linhas alcançadas DEPOIS da gravação, com as mesmas regras de `persistLinhasCategorizadas`:
 * as de `idsParaApagar` somem; cada linha da rodada é criada ou atualizada — exceto a revisada manualmente, cujo
 * valor é congelado (o update omite `valorRecebidoCat`).
 */
export function avaliarQuedaLiquida(
  existentes: LinhaGravadaComValor[],
  idsParaApagar: string[],
  linhas: LinhaDaRodadaComValor[],
  limites: { percentual: number; valor: Money } = { percentual: LIMITE_QUEDA_PERCENTUAL, valor: LIMITE_QUEDA_VALOR },
): AvaliacaoQueda {
  const apagar = new Set(idsParaApagar);
  const estado = new Map<string, Money>();
  const revisada = new Map<string, boolean>();
  let antes = ZERO;
  for (const e of existentes) {
    const chave = chaveLinhaCompleta(e.crConexaId, e.chaveLinha, e.mesCredito);
    antes = antes.plus(e.valorRecebidoCat);
    revisada.set(chave, e.revisadoManualmente);
    if (!apagar.has(e.id)) estado.set(chave, e.valorRecebidoCat);
  }
  for (const l of linhas) {
    const chave = chaveLinhaCompleta(l.crId, l.chaveLinha, mesDoCreditoOuSentinela(l.dataCredito));
    if (revisada.get(chave) === true) continue;
    estado.set(chave, l.valorRecebidoCategoria);
  }
  let depois = ZERO;
  for (const v of estado.values()) depois = depois.plus(v);

  const queda = antes.minus(depois);
  const percentual = antes.greaterThan(0) ? queda.div(antes).times(100).toDecimalPlaces(1).toNumber() : 0;
  const bloquear = queda.greaterThanOrEqualTo(limites.valor) && percentual >= limites.percentual;
  return { antes, depois, queda, percentual, linhasRemovidas: apagar.size, bloquear };
}

/** A mensagem que aparece na rodada FAILED (Sincronizações, `estado_do_sistema`). */
export function mensagemRemocaoEmMassa(a: AvaliacaoQueda): string {
  return (
    "Rodada interrompida por segurança: gravar este resultado derrubaria a receita que o painel tem para o período " +
    `de ${formatBRL(a.antes)} para ${formatBRL(a.depois)} (queda de ${formatBRL(a.queda)}, ${formatPercent(a.percentual)}), ` +
    `removendo ${a.linhasRemovidas} linha(s). Isso costuma ser export incompleto do Conexa, não receita que sumiu. ` +
    "Nada foi gravado. Se a queda for real, use Sincronizações → Importar arquivos do Conexa: a prévia mostra o efeito e pede confirmação."
  );
}
