import type { Money } from "@/lib/money";

export type ProporcionadoTipo = "N" | "S" | "SEM_LV";

export interface ContasReceberRow {
  id: number;
  unidade: string;
  faturamento: string;
  clienteId: number | null;
  cpfCnpj: string;
  razaoSocial: string;
  planoContratado: string;
  tipo: string;
  status: string;
  parcela: string;
  valorBruto: Money;
  valorRecebido: Money;
  valorDesconto: Money;
  vencimento: Date | null;
  quitacao: Date | null;
  competencia: Date | null;
  emissao: Date | null;
  dataCredito: Date | null;
  conta: string;
  observacoes: string;
  tags: string;
  raw: Record<string, string>;
  /**
   * TODOS os meses "yyyy-MM" da lista de Data Crédito desta fatura — a verdade
   * do Conexa sobre em quais meses ela credita, independente da janela da
   * rodada. É o que a limpeza de órfãs usa para decidir (ADR-0029): uma linha
   * de um mês só é órfã se aquele mês SUMIU desta lista. Escopar essa decisão
   * pela janela da rodada destruía dinheiro nos dois sentidos — ver
   * mesesCreditoDaFatura() em parse-exports.ts.
   */
  mesesCredito: string[];
}

export interface ListarVendasRow {
  id: number;
  clienteId: number | null;
  servicoItem: string;
  categoriaConexa: string;
  data: Date | null;
  valor: Money;
  valorDesconto: Money;
  status: string;
  referenciaCobranca: Date | null;
  raw: Record<string, string>;
}

/**
 * Um item de LV (Lançamentos/Vendas) que entrou numa linha categorizada, com o
 * valor rateado que ELE contribuiu — o detalhe que o motor sempre calculou e
 * até 2026-07-28 jogava fora ao somar o bucket da categoria (ADR-0028).
 *
 * Existe para responder "destes R$ 123,75, quanto é de cada sala?": a fatura
 * real tem os 3 itens separados (48,75 + 48,75 + 26,25), mas a linha gravada
 * só tinha o total e os nomes concatenados. Sem isso, a integração ClickUp
 * precisa dar a linha inteira a UM vínculo (o mais antigo), creditando receita
 * à sala errada.
 *
 * NUNCA usar `servicoItem` como chave: itens idênticos aparecem repetidos de
 * propósito na mesma fatura (ver comentário da Fase 2 em categorize-invoices).
 * `lvId` é a identidade estável.
 */
export interface ItemDaLinha {
  lvId: number;
  servicoItem: string;
  /** Categoria que o próprio Conexa atribuiu ao item — informativa, nunca usada no cálculo. */
  categoriaConexa: string;
  /** Valor bruto do item no LV, antes do rateio. */
  valorBruto: string;
  /** Quanto ESTE item contribuiu para o `valorRecebidoCategoria` da linha (já arredondado por item). */
  valorRateado: string;
}

export interface CategorizedLine {
  crId: number;
  unidade: string;
  faturamento: string;
  clienteId: number | null;
  cpfCnpj: string;
  razaoSocial: string;
  planoContratado: string;
  categoria: string;
  /** Nome exato buscado contra RevenueCategoryRule (Serviço/Item do LV, ou o
   *  plano contratado quando SEM_LV) — permite auditar/corrigir "Sem Categoria". */
  servicoOuPlano: string;
  /** Identidade estável do bucket dentro da fatura, para upsert entre rodadas
   *  (ver categorize-invoices.ts `chaveLinhaDoBucket` e ADR-0013). Nunca muda
   *  mesmo que uma revisão manual sobrescreva `categoria` depois. */
  chaveLinha: string;
  proporcionado: ProporcionadoTipo;
  tipo: string;
  status: string;
  parcela: string;
  valorRecebidoCategoria: Money;
  valorRecebidoTotal: Money;
  valorBruto: Money;
  valorDesconto: Money;
  vencimento: Date | null;
  quitacao: Date | null;
  competencia: Date | null;
  emissao: Date | null;
  dataCredito: Date | null;
  conta: string;
  observacoes: string;
  tags: string;
  raw: Record<string, unknown>;
  /**
   * TODOS os meses "yyyy-MM" da lista de Data Crédito desta fatura — a verdade
   * do Conexa sobre em quais meses ela credita, independente da janela da
   * rodada. É o que a limpeza de órfãs usa para decidir (ADR-0029): uma linha
   * de um mês só é órfã se aquele mês SUMIU desta lista. Escopar essa decisão
   * pela janela da rodada destruía dinheiro nos dois sentidos — ver
   * mesesCreditoDaFatura() em parse-exports.ts.
   */
  mesesCreditoFatura: string[];
  /**
   * Itens de LV que compõem esta linha (ADR-0028). Ausente quando a fatura não
   * tem LV casado (`proporcionado: "SEM_LV"`) — nesse caso não existe item
   * nenhum, a linha veio do plano contratado do CR.
   *
   * INVARIANTE, com uma exceção conhecida: a soma de `valorRateado` dos itens
   * é igual a `valorRecebidoCategoria`, EXCETO no último bucket da fatura, que
   * recebe o resíduo de arredondamento inteiro (ver `ajusteArredondamento`).
   */
  itens?: ItemDaLinha[];
  /**
   * Resíduo de centavos que a Fase 3 joga no ÚLTIMO bucket da fatura para
   * fechar em `cr.valorRecebido`. Fica em campo próprio, e NÃO é redistribuído
   * entre os itens, porque redistribuir mudaria valores que o motor já
   * calculou — o que esta mudança não pode fazer (ADR-0028). Só é preenchido
   * (e só é ≠ 0) na linha que recebeu o ajuste.
   */
  ajusteArredondamento?: string;
}

export interface CategorizationRunResult {
  linhas: CategorizedLine[];
  totalLinhasCR: number;
  totalLinhasLV: number;
  totalSemLV: number;
  totalRecebido: Money;
  resumoPorCategoria: Array<{ categoria: string; total: string }>;
  servicosNaoMapeados: string[];
}

/**
 * Filtro de status do CR — porta EXATA do script real (ADR-0018): substring,
 * NÃO lista fechada. Python: `if "Quitada" not in status and "Negociação" not
 * in status: continue` — aceita QUALQUER status que contenha "Quitada" OU
 * "Negociação" como substring, não só as duas strings exatas documentadas no
 * SKILL.md (que era uma simplificação da prosa, não o comportamento real).
 */
export function statusAceitoCR(status: string): boolean {
  return status.includes("Quitada") || status.includes("Negociação");
}

/** Filtro de status do LV — lista fechada, confirmado igual ao script real. */
export const STATUS_ACEITOS_LV = ["Quitada", "Quitada Parcialmente", "Descontada de Cota"];
