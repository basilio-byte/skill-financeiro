import type { PeriodBounds, PeriodKind } from "@/lib/dates";

/**
 * Lógica PURA de período para metas (sem Prisma, sem Next) — testável com
 * fixtures, mesmo padrão de categorize-invoices.ts e auto-sync-window.ts.
 */

/** Granularidades em que a meta faz sentido. Mês é o átomo. */
const KINDS_COM_META: PeriodKind[] = ["month", "quarter", "semester", "year"];

/**
 * A meta é sempre MENSAL. Em dia e semana não existe resposta honesta:
 * ratear a meta do mês por dias assumiria receita uniforme, e `dataCredito`
 * concentra nas datas de vencimento — o número pareceria apurado e seria
 * inventado. Melhor não exibir e dizer por quê.
 */
export function periodoAceitaMeta(kind: PeriodKind): boolean {
  return KINDS_COM_META.includes(kind);
}

/**
 * Meses "yyyy-MM" que o período cobre.
 *
 * Usa UTC de ponta a ponta: `PeriodBounds` já vem ajustado ao fuso do app por
 * `getPeriodBounds`, e `dataCredito` é `@db.Date`. Reaplicar fuso aqui
 * repetiria o bug CRÍTICO da ADR-0013 (fuso aplicado duas vezes fazia a janela
 * do mês corrente regredir para o mês anterior nas primeiras horas do dia 1).
 */
export function mesesDoPeriodo(periodo: PeriodBounds): string[] {
  const meses: string[] = [];
  const cursor = new Date(
    Date.UTC(periodo.fromDate.getUTCFullYear(), periodo.fromDate.getUTCMonth(), 1),
  );
  // `toDateExclusive` é exclusivo: um período que termina em 01/08 00:00 não
  // inclui agosto. Recuar 1ms encontra o último instante realmente coberto.
  const ultimo = new Date(periodo.toDateExclusive.getTime() - 1);
  const limite = Date.UTC(ultimo.getUTCFullYear(), ultimo.getUTCMonth(), 1);

  while (cursor.getTime() <= limite) {
    const ano = cursor.getUTCFullYear();
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    meses.push(`${ano}-${mes}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return meses;
}

/** "yyyy-MM" de uma data (UTC), para agrupar linhas por mês. */
export function mesDaData(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Formato aceito em MetaPeriodo.anoMes — espelha o CHECK constraint da migration. */
export const ANO_MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Fração do período já decorrida (0..1), ou null se o período não contém
 * `agora` — passado (nada a projetar, já fechou) ou futuro (nada decorrido).
 *
 * Alimenta o marcador de "ritmo esperado". É uma referência LINEAR e assumida
 * como tal: a receita real entra concentrada nas datas de crédito, então a
 * marca fica pessimista no começo do mês. A UI rotula isso explicitamente em
 * vez de apresentar como previsão.
 */
export function fracaoDecorrida(periodo: PeriodBounds, agora: Date): number | null {
  const inicio = periodo.fromDate.getTime();
  const fim = periodo.toDateExclusive.getTime();
  const t = agora.getTime();
  if (t < inicio || t >= fim) return null;
  if (fim <= inicio) return null;
  return (t - inicio) / (fim - inicio);
}
