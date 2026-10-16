/**
 * Filtros da tela Revisar (pedido da Duda na task 86aktrw6v): por MÊS de crédito e por PROPORCIONADO.
 *
 * Pura. Valor desconhecido ou malformado é IGNORADO (a tela mostra tudo, como sempre), nunca vira erro nem
 * entra numa consulta: o que vem da URL é entrada do usuário.
 */

export type ProporcionadoRevisavel = "S" | "SEM_LV";

export interface FiltrosRevisao {
  /** "yyyy-MM" do mês de crédito, ou null = todos os meses. */
  mes: string | null;
  /** Só rateadas (S), só sem Listar Vendas (SEM_LV), ou null = as duas. */
  proporcionado: ProporcionadoRevisavel | null;
}

type Bruto = string | string[] | undefined;
const primeiro = (v: Bruto) => (Array.isArray(v) ? v[0] : v);

export function lerFiltrosRevisao(params: { mes?: Bruto; proporcionado?: Bruto }): FiltrosRevisao {
  const mesBruto = primeiro(params.mes)?.trim();
  // "0000-00" é o mês sentinela de linha sem data (mes-credito.ts): não é um mês de verdade para filtrar.
  const mes = mesBruto && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesBruto) ? mesBruto : null;

  const propBruto = primeiro(params.proporcionado)?.trim();
  const proporcionado: ProporcionadoRevisavel | null = propBruto === "S" || propBruto === "SEM_LV" ? propBruto : null;

  return { mes, proporcionado };
}

/** Algum filtro ativo? (para mostrar o "Limpar".) */
export const temFiltroRevisao = (f: FiltrosRevisao): boolean => f.mes !== null || f.proporcionado !== null;
