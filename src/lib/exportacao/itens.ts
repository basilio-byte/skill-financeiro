import { money, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import type { LinhaReceita } from "./colunas-receita";
import { abaDeTabela, type ColunaTabela } from "./planilha";
import { ExportacaoGrandeDemaisError } from "./tipos";

/**
 * A aba ITENS da exportação de receita (ADR-0035): os itens do Listar Vendas que compõem cada linha, com o valor
 * rateado que cada um contribuiu (`itensDetalhe`, ADR-0028). Puro.
 *
 * Invariante do motor (ADR-0028): soma(itens.valorRateado) + ajusteArredondamento = valorRecebidoCat da linha. A aba
 * preserva isso para que a soma de "Valor Rateado" seja SEMPRE o total do detalhe — e nenhuma linha some em silêncio:
 *  - linha REVISADA à mão não usa os itens (a revisão pode ter mudado o valor; mesma regra de clickup/composicao.ts);
 *  - linha SEM itens (SEM_LV, ou gravada antes da ADR-0028) vira UMA linha marcada;
 *  - linha cujos itens NÃO fecham com o valor vira UMA linha marcada e entra no aviso do Leia-me (nunca é "consertada").
 */

export interface ItemBruto {
  lvId: number;
  servicoItem: string;
  categoriaConexa: string;
  valorBruto: string;
  valorRateado: string;
}

const DEC = /^-?\d+(\.\d+)?$/;

/** Valida o JSON do banco: `null` se não for uma lista não vazia de itens bem formados. Nunca confia no formato. */
export function lerItens(json: unknown): ItemBruto[] | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const itens: ItemBruto[] = [];
  for (const x of json) {
    if (typeof x !== "object" || x === null) return null;
    const o = x as Record<string, unknown>;
    if (typeof o.servicoItem !== "string" || typeof o.valorRateado !== "string" || !DEC.test(o.valorRateado)) return null;
    itens.push({
      lvId: typeof o.lvId === "number" ? o.lvId : 0,
      servicoItem: o.servicoItem,
      categoriaConexa: typeof o.categoriaConexa === "string" ? o.categoriaConexa : "",
      valorBruto: typeof o.valorBruto === "string" && DEC.test(o.valorBruto) ? o.valorBruto : "",
      valorRateado: o.valorRateado,
    });
  }
  return itens;
}

/** Teto de linhas da aba (cada linha da receita pode ter vários itens). */
export const MAX_LINHAS_ITENS = 60_000;

export interface ResumoItens {
  aba: Sheet;
  /** Soma de "Valor Rateado": tem de ser igual ao total do detalhe. */
  soma: Money;
  linhasDeItem: number;
  comItens: number;
  semItens: number;
  revisadas: number;
  naoFecham: number;
  /** Frase pronta para o Leia-me. */
  aviso: string;
}

const COLUNAS: ColunaTabela[] = [
  { titulo: "ID Fatura", tipo: "id", largura: 11 },
  { titulo: "Mês de Crédito", tipo: "texto", largura: 12 },
  { titulo: "Data Crédito", tipo: "data", largura: 13 },
  { titulo: "Razão Social Cliente", tipo: "texto", largura: 36 },
  { titulo: "Categoria (da linha)", tipo: "texto", largura: 34 },
  { titulo: "Serviço/Plano (da linha)", tipo: "texto", largura: 44 },
  { titulo: "ID Item (Listar Vendas)", tipo: "id", largura: 13 },
  { titulo: "Item", tipo: "texto", largura: 44 },
  { titulo: "Categoria no Conexa (informativa)", tipo: "texto", largura: 28 },
  { titulo: "Valor Bruto do item — antes do rateio, NÃO somar", tipo: "dinheiro", largura: 20 },
  { titulo: "Valor Rateado (para esta linha)", tipo: "dinheiro", largura: 18 },
  { titulo: "Observação", tipo: "texto", largura: 46 },
];
const INDICE_RATEADO = 10;

type Linha = Array<string | number | Date | null>;

export function abaDeItens(linhas: LinhaReceita[]): ResumoItens {
  const rows: Linha[] = [];
  let comItens = 0;
  let semItens = 0;
  let revisadas = 0;
  let naoFecham = 0;
  let soma: Money = ZERO;

  const cabecalho = (l: LinhaReceita): Linha => [l.crConexaId, l.mesCredito, l.dataCredito, l.razaoSocial, l.categoria, l.servicoOuPlano];
  const unica = (l: LinhaReceita, item: string, obs: string): Linha => [...cabecalho(l), null, item, null, null, l.valorRecebidoCat, obs];

  for (const l of linhas) {
    if (l.revisadoManualmente) {
      revisadas += 1;
      rows.push(unica(l, "(linha revisada manualmente)", "Valor revisado à mão: os itens do motor não valem para esta linha."));
      soma = soma.plus(money(l.valorRecebidoCat));
      continue;
    }
    const itens = lerItens(l.itensDetalhe);
    if (!itens) {
      semItens += 1;
      rows.push(unica(l, "(sem detalhe de itens)", l.proporcionado === "SEM_LV" ? "Sem item no Listar Vendas (categoria veio do plano contratado)." : "Linha gravada sem detalhe por item."));
      soma = soma.plus(money(l.valorRecebidoCat));
      continue;
    }
    const somaItens = sum(itens.map((i) => i.valorRateado));
    const ajuste = money(l.ajusteArredondamento ?? "0");
    if (!somaItens.plus(ajuste).equals(money(l.valorRecebidoCat))) {
      naoFecham += 1;
      rows.push(unica(l, "(itens não fecham com o valor da linha)", `Os itens somam ${toAmountString(somaItens)} e o ajuste é ${toAmountString(ajuste)}, mas a linha vale ${l.valorRecebidoCat}. Não corrigido aqui.`));
      soma = soma.plus(money(l.valorRecebidoCat));
      continue;
    }
    comItens += 1;
    for (const i of itens) {
      rows.push([...cabecalho(l), i.lvId || null, i.servicoItem, i.categoriaConexa || null, i.valorBruto || null, i.valorRateado, null]);
      soma = soma.plus(money(i.valorRateado));
    }
    if (!ajuste.isZero()) {
      rows.push([...cabecalho(l), null, "(ajuste de arredondamento)", null, null, toAmountString(ajuste), "Resíduo de centavos do rateio, não atribuível a um item."]);
      soma = soma.plus(ajuste);
    }
  }

  if (rows.length > MAX_LINHAS_ITENS) {
    throw new ExportacaoGrandeDemaisError(
      `A aba Itens teria ${rows.length.toLocaleString("pt-BR")} linhas e o máximo é ${MAX_LINHAS_ITENS.toLocaleString("pt-BR")}. Reduza o período ou acrescente filtros, ou desmarque a aba Itens.`,
    );
  }

  const total = toAmountString(soma);
  const aba = abaDeTabela({
    nome: "Itens",
    colunas: COLUNAS,
    linhas: rows,
    total: ["TOTAL", ...COLUNAS.slice(1).map((_, i) => (i + 1 === INDICE_RATEADO ? total : null))],
    nota: "Soma de 'Valor Rateado' = soma de 'Valor Recebido Cat.' do detalhe: cada item contribui com a parte que lhe coube na linha. 'Valor Bruto do item' é o valor cheio no Listar Vendas, antes do rateio entre categorias: não soma.",
  });

  const partes = [`${rows.length.toLocaleString("pt-BR")} linha(s) de item para ${linhas.length.toLocaleString("pt-BR")} linha(s) da receita`];
  if (semItens) partes.push(`${semItens} sem detalhe de itens`);
  if (revisadas) partes.push(`${revisadas} revisada(s) à mão (sem itens)`);
  if (naoFecham) partes.push(`${naoFecham} com itens que NÃO fecham com o valor da linha (marcadas, não corrigidas)`);
  return { aba, soma, linhasDeItem: rows.length, comItens, semItens, revisadas, naoFecham, aviso: `Aba Itens: ${partes.join("; ")}.` };
}
