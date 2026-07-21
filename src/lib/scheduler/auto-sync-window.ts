import { getPeriodBounds, nowInAppTz } from "@/lib/dates";

/**
 * Janela da sincronização automática: mês corrente (dia 1 até agora, no fuso
 * do app) — decisão explícita do usuário (ADR-0013).
 *
 * Módulo separado de auto-sync.ts (que tem `server-only` e depende de
 * Prisma/env) para ficar puro e testável com Vitest, mesmo padrão já usado
 * em categorize-invoices.ts/dates.ts.
 *
 * Cuidado (achado por verificação adversarial): `getPeriodBounds(kind, ref)`
 * SEMPRE aplica `toZonedTime` quando `ref` é um `Date` — correto quando quem
 * chama passa um instante "cru" (ex.: nos testes), mas `nowInAppTz()` já
 * devolve um Date JÁ ajustado ao fuso. Repassar esse valor para
 * `getPeriodBounds` como `Date` fusaria DUAS vezes (bug real: perto da
 * virada do mês, no fuso America/Fortaleza (UTC-3), isso podia fazer
 * `periodoInicio` cair no mês ANTERIOR durante as primeiras ~3h de todo
 * mês). Por isso, no caminho de produção (sem `referencia` explícita),
 * `getPeriodBounds("month")` é chamado SEM segundo argumento — ele mesmo
 * chama `nowInAppTz()` internamente, uma única vez.
 */
export function computeAutoSyncWindow(referencia?: Date): { periodoInicio: Date; periodoFim: Date } {
  const agora = referencia ?? nowInAppTz();
  const periodo = referencia ? getPeriodBounds("month", referencia) : getPeriodBounds("month");
  return {
    periodoInicio: periodo.fromDate,
    periodoFim: agora,
  };
}
