import { toZonedTime } from "date-fns-tz";
import { APP_TZ, getPeriodBounds, keyToUtcDate, nowInAppTz, shiftPeriodKey } from "@/lib/dates";

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

/**
 * Por quantos dias, depois da virada do mês, o mês ANTERIOR continua sendo
 * sincronizado (ADR-0030). 10 dias cobre com folga a janela em que a Duda
 * fecha o mês e em que as baixas retroativas são lançadas.
 */
export const DIAS_DE_CARENCIA_PADRAO = 10;

/**
 * Janela de CARÊNCIA: o mês anterior INTEIRO, durante os primeiros
 * `diasDeCarencia` dias do mês corrente. `null` fora desse período.
 *
 * Por que existe (ADR-0030): até aqui, um mês parava de ser sincronizado no
 * instante em que virava — `computeAutoSyncWindow` só cobre o mês corrente, e
 * nenhum outro caminho reprocessa mês passado. Medido em produção em
 * 2026-09-08: agosto congelou em 31/08 23:56 (o último tick antes da virada) e
 * ficou R$ 10,10 diferente do Conexa. E a defasagem corre nos DOIS sentidos:
 *
 *  - não entra o que chega depois — fatura 29692 (R$ 70,00, crédito 24/08)
 *    teve a baixa lançada em 02/09, retroativa; em 31/08 ainda não estava
 *    "Quitada", então NENHUMA rodada a viu e nenhuma veria;
 *  - não sai o que deixou de valer — fatura 29619 (R$ 59,90, gravada em 18/08)
 *    sumiu do export de agosto, mas a limpeza de órfãs (persist.ts + orfas.ts)
 *    só avalia faturas que a rodada tocou, e nenhuma rodada tocava agosto.
 *
 * Não é específico de agosto: TODO mês fechado congela com os erros que tiver,
 * justamente na janela em que o financeiro fecha o mês.
 *
 * **É uma janela SEPARADA, e não uma janela ampla "mês anterior + corrente",
 * de propósito.** Uma rodada só consegue emitir UMA parcela por fatura
 * (`parseDataCreditoNoPeriodo` devolve a PRIMEIRA data da lista que cai no
 * período), então uma janela 01/08–30/09 emitiria a parcela de AGOSTO das
 * recorrentes e deixaria a de setembro sem ser produzida — o mês corrente
 * pararia de ser atualizado a cada 15 min, e linhas novas de setembro nem
 * seriam criadas. É exatamente o bug crítico nº 1 da ADR-0029 (ver orfas.ts),
 * que a revisão adversarial pegou. Duas rodadas, cada uma com sua janela de mês
 * fechado, mantêm `mesesNoIntervalo` com um mês só e `decidirOrfas` com
 * autoridade sobre o mês que acabou de cobrir.
 *
 * `periodoFim` é o ÚLTIMO DIA do mês anterior (inclusive), não "agora" —
 * diferente da janela do mês corrente. O mês já terminou; não há motivo para
 * cortar em uma hora do dia, e `run.ts` ainda aplica `periodoFimEfetivo`
 * (nunca aceita data de crédito futura) por cima.
 */
export function computeCarenciaWindow(
  referencia?: Date,
  diasDeCarencia: number = DIAS_DE_CARENCIA_PADRAO,
): { periodoInicio: Date; periodoFim: Date } | null {
  if (diasDeCarencia <= 0) return null;

  // Dia do mês NO FUSO DO APP. Mesma armadilha de fuso duplo documentada
  // acima: `nowInAppTz()` já vem ajustado (não pode ser re-fusado), enquanto
  // uma `referencia` explícita é um instante cru e PRECISA ser convertida.
  // Ler `getDate()` do Date cru daria o dia em UTC — nas primeiras 3h de todo
  // dia 11, em UTC-3, isso ainda seria "dia 10" lá fora e a carência duraria
  // um dia a mais do que o configurado.
  const zonado = referencia ? toZonedTime(referencia, APP_TZ) : nowInAppTz();
  if (zonado.getDate() > diasDeCarencia) return null;

  const correnteKey = referencia
    ? getPeriodBounds("month", referencia).fromKey
    : getPeriodBounds("month").fromKey;
  // Chave 'yyyy-MM-dd' (string), nunca Date: `getPeriodBounds` com string usa
  // `parseCalendarKey` e NÃO aplica `toZonedTime` — é o caminho imune ao fuso
  // duplo, e o mesmo motivo pelo qual `shiftPeriodKey` opera sobre a chave.
  const anterior = getPeriodBounds("month", shiftPeriodKey(correnteKey, "month", -1));

  return {
    periodoInicio: anterior.fromDate,
    // `toKey` é o último dia do mês (inclusive) — `toDateExclusive` seria o
    // dia 1 do mês corrente e faria a rodada reivindicar DOIS meses em
    // `mesesNoIntervalo`, dando a `decidirOrfas` autoridade sobre um mês que
    // esta rodada não representa.
    periodoFim: keyToUtcDate(anterior.toKey),
  };
}
