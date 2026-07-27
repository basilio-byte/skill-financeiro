import type { PeriodBounds, PeriodKind } from "@/lib/dates";

/**
 * Lógica PURA de período para metas (sem Prisma, sem Next) — testável com
 * fixtures, mesmo padrão de categorize-invoices.ts e auto-sync-window.ts.
 *
 * Trocado de mensal para trimestral em 2026-07-24 (alinhado com a Duda) —
 * trimestre é o átomo agora, mês não aceita mais meta (nem dia/semana).
 */

/** Granularidades em que a meta faz sentido. Trimestre é o átomo. */
const KINDS_COM_META: PeriodKind[] = ["quarter", "semester", "year"];

/**
 * A meta é sempre TRIMESTRAL. Em dia, semana e mês não existe resposta
 * honesta: ratear a meta do trimestre por um recorte menor assumiria receita
 * uniforme, e `dataCredito` concentra nas datas de vencimento — o número
 * pareceria apurado e seria inventado. Melhor não exibir e dizer por quê.
 */
export function periodoAceitaMeta(kind: PeriodKind): boolean {
  return KINDS_COM_META.includes(kind);
}

/**
 * Trimestres "yyyy-Q#" (Q1..Q4, trimestre civil) que o período cobre.
 *
 * Usa UTC de ponta a ponta: `PeriodBounds` já vem ajustado ao fuso do app por
 * `getPeriodBounds`, e `dataCredito` é `@db.Date`. Reaplicar fuso aqui
 * repetiria o bug CRÍTICO da ADR-0013 (fuso aplicado duas vezes fazia a janela
 * do mês corrente regredir para o mês anterior nas primeiras horas do dia 1).
 */
export function trimestresDoPeriodo(periodo: PeriodBounds): string[] {
  const trimestres: string[] = [];
  const inicioTrimestre = (d: Date) => Math.floor(d.getUTCMonth() / 3) * 3;

  const cursor = new Date(Date.UTC(periodo.fromDate.getUTCFullYear(), inicioTrimestre(periodo.fromDate), 1));
  // `toDateExclusive` é exclusivo: um período que termina em 01/10 00:00 não
  // inclui outubro. Recuar 1ms encontra o último instante realmente coberto.
  const ultimo = new Date(periodo.toDateExclusive.getTime() - 1);
  const limite = Date.UTC(ultimo.getUTCFullYear(), inicioTrimestre(ultimo), 1);

  while (cursor.getTime() <= limite) {
    trimestres.push(trimestreDaData(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 3);
  }
  return trimestres;
}

/** "yyyy-Q#" de uma data (UTC), para agrupar linhas por trimestre civil. */
export function trimestreDaData(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

/** Formato aceito em MetaPeriodo.anoTrimestre — espelha o CHECK constraint da migration. */
export const ANO_TRIMESTRE_RE = /^\d{4}-Q[1-4]$/;

/**
 * Fração do período já decorrida (0..1), ou null se o período não contém
 * `agora` — passado (nada a projetar, já fechou) ou futuro (nada decorrido).
 *
 * Alimenta o marcador de "ritmo esperado". É uma referência LINEAR e assumida
 * como tal: a receita real entra concentrada nas datas de crédito, então a
 * marca fica pessimista no começo do trimestre. A UI rotula isso explicitamente
 * em vez de apresentar como previsão.
 */
export function fracaoDecorrida(periodo: PeriodBounds, agora: Date): number | null {
  const inicio = periodo.fromDate.getTime();
  const fim = periodo.toDateExclusive.getTime();
  const t = agora.getTime();
  if (t < inicio || t >= fim) return null;
  if (fim <= inicio) return null;
  return (t - inicio) / (fim - inicio);
}
