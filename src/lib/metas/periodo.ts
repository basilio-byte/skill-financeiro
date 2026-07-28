import type { PeriodBounds, PeriodKind } from "@/lib/dates";
import type { MetaGranularidade } from "@prisma/client";

/**
 * Lógica PURA de período para metas (sem Prisma, sem Next) — testável com
 * fixtures, mesmo padrão de categorize-invoices.ts e auto-sync-window.ts.
 *
 * Mensal e trimestral coexistem como séries INDEPENDENTES (reintroduzido
 * 2026-07-28, pedido do usuário — mês tinha sido removido em 2026-07-24).
 * Mês nunca soma pra virar trimestre nem trimestre se divide pra virar mês;
 * cada granularidade é um número que alguém define direto. Dia e semana
 * continuam recusados — nem mês nem trimestre respondem por um recorte tão
 * fino sem inventar dado.
 */

/** Granularidade de MetaPeriodo que cada kind de Panorama usa, ou null se não aceita meta. */
export function granularidadeDoKind(kind: PeriodKind): MetaGranularidade | null {
  if (kind === "month") return "MES";
  if (kind === "quarter" || kind === "semester" || kind === "year") return "TRIMESTRE";
  return null;
}

/**
 * Dia e semana não têm resposta honesta em NENHUMA granularidade: ratear uma
 * meta mensal ou trimestral por um recorte tão fino assumiria receita
 * uniforme, e `dataCredito` concentra nas datas de vencimento — o número
 * pareceria apurado e seria inventado. Mês e trimestre agora são átomos
 * diretos (cada um com sua própria série), nunca rateados um do outro.
 */
export function periodoAceitaMeta(kind: PeriodKind): boolean {
  return granularidadeDoKind(kind) !== null;
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

/** "yyyy-MM" de uma data (UTC), para agrupar linhas por mês civil. */
export function mesDaData(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Meses "yyyy-MM" que o período cobre. Diferente de `trimestresDoPeriodo`,
 * só é chamada com `periodo.kind === "month"` na prática (mês é sempre o
 * átomo da sua própria série, nunca some pra semestre/ano) — mas devolve a
 * lista genérica mesmo assim, sem assumir isso, pelo mesmo motivo de
 * segurança documentado em `trimestresDoPeriodo`.
 */
export function mesesDoPeriodo(periodo: PeriodBounds): string[] {
  const meses: string[] = [];
  const cursor = new Date(Date.UTC(periodo.fromDate.getUTCFullYear(), periodo.fromDate.getUTCMonth(), 1));
  const ultimo = new Date(periodo.toDateExclusive.getTime() - 1);
  const limite = Date.UTC(ultimo.getUTCFullYear(), ultimo.getUTCMonth(), 1);

  while (cursor.getTime() <= limite) {
    meses.push(mesDaData(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return meses;
}

/**
 * Chaves de período (mês ou trimestre, conforme a granularidade) que o
 * período cobre — ponto único que `metas.ts` usa pra não precisar saber qual
 * das duas funções chamar.
 */
export function chavesDoPeriodo(periodo: PeriodBounds, granularidade: MetaGranularidade): string[] {
  return granularidade === "MES" ? mesesDoPeriodo(periodo) : trimestresDoPeriodo(periodo);
}

/** Chave de período (mês ou trimestre) de uma data, conforme a granularidade. */
export function chaveDaData(d: Date, granularidade: MetaGranularidade): string {
  return granularidade === "MES" ? mesDaData(d) : trimestreDaData(d);
}

/** Formato aceito em MetaPeriodo.periodoChave — espelham o CHECK constraint composto da migration. */
export const ANO_TRIMESTRE_RE = /^\d{4}-Q[1-4]$/;
export const ANO_MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
