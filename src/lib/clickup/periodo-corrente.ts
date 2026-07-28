import { toZonedTime } from "date-fns-tz";
import { APP_TZ, getPeriodBounds, nowInAppTz } from "@/lib/dates";

/**
 * Módulo separado de push.ts (que tem `server-only` e depende de Prisma) para
 * ficar puro e testável com Vitest, mesmo padrão de scheduler/auto-sync-window.ts.
 */

export interface PeriodoCorrente {
  ano: number;
  mes: number;
  fromDate: Date;
  toDateExclusive: Date;
}

/**
 * Mês corrente (ano/mês + limites de `dataCredito`) usado pelo push do
 * ClickUp. Mesma armadilha de fuso duplo já documentada e corrigida em
 * scheduler/auto-sync-window.ts: `nowInAppTz()` já devolve um Date ajustado ao
 * fuso — repassar esse valor como segundo argumento de `getPeriodBounds`
 * fusaria DUAS vezes (podia fazer o período cair no mês ANTERIOR nas
 * primeiras ~3h de todo mês, America/Fortaleza UTC-3). Achado por revisão
 * adversarial 2026-07-27 reintroduzindo esse bug já corrigido em outro lugar
 * do projeto — por isso este módulo existe separado e testado, em vez de
 * ficar reimplementado inline dentro de push.ts.
 *
 * `referenciaCrua` (instante bruto, NÃO ajustado ao fuso) existe só para
 * teste determinístico (mesmo padrão de `computeAutoSyncWindow`) — o caminho
 * de produção nunca passa nada, sempre usa `nowInAppTz()`/`getPeriodBounds()`
 * sem argumento.
 */
export function periodoCorrente(referenciaCrua?: Date): PeriodoCorrente {
  const agora = referenciaCrua ? toZonedTime(referenciaCrua, APP_TZ) : nowInAppTz();
  const periodo = referenciaCrua ? getPeriodBounds("month", referenciaCrua) : getPeriodBounds("month");
  return { ano: agora.getFullYear(), mes: agora.getMonth() + 1, fromDate: periodo.fromDate, toDateExclusive: periodo.toDateExclusive };
}

/**
 * Limites de `dataCredito` de um mês (ano/mês civis), para reapurar um período
 * que NÃO é necessariamente o corrente — é o que a tela de detalhamento usa
 * para listar as faturas do mês de um `ClickUpPushLog` já gravado.
 *
 * Precisa produzir EXATAMENTE os mesmos limites que `periodoCorrente()` produz
 * quando o (ano, mes) é o de hoje: se divergir, a tela listaria faturas de uma
 * janela diferente da que o push somou, e a lista não fecharia com o valor —
 * exatamente o tipo de erro silencioso que esta tela existe para não cometer.
 * Travado por teste.
 */
export function limitesDoMes(ano: number, mes: number): { fromDate: Date; toDateExclusive: Date } {
  const periodo = getPeriodBounds("month", `${ano}-${String(mes).padStart(2, "0")}-01`);
  return { fromDate: periodo.fromDate, toDateExclusive: periodo.toDateExclusive };
}
