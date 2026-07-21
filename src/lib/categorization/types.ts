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

/** Status aceitos — faturas fora disso são ignoradas antes do join. Ver docs/context/decisions.md. */
export const STATUS_ACEITOS_CR = ["Quitada", "Quitada (Gerada por Negociação)"];
export const STATUS_ACEITOS_LV = ["Quitada", "Quitada Parcialmente", "Descontada de Cota"];
