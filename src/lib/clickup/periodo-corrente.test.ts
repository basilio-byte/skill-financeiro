import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limitesDoMes, periodoCorrente } from "@/lib/clickup/periodo-corrente";

describe("periodoCorrente (mês corrente do push do ClickUp)", () => {
  it("resolve ano/mês e os limites do mês a partir de uma referência explícita", () => {
    // 21/07/2026 12:00 UTC ~ 09:00 America/Fortaleza (UTC-3), mesmo dia-calendário.
    const referencia = new Date(Date.UTC(2026, 6, 21, 12, 0, 0));
    const r = periodoCorrente(referencia);
    expect(r.ano).toBe(2026);
    expect(r.mes).toBe(7);
    expect(r.fromDate.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("dezembro permanece no ano corrente (sem cruzar virada de ano)", () => {
    const referencia = new Date(Date.UTC(2026, 11, 15, 12, 0, 0));
    const r = periodoCorrente(referencia);
    expect(r.ano).toBe(2026);
    expect(r.mes).toBe(12);
  });

  describe("caminho de produção (sem referência explícita — regressão de fuso duplo, achada por revisão adversarial 2026-07-27)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("logo após a virada do mês (fuso America/Fortaleza, UTC-3), NÃO regride para o mês anterior", () => {
      // 2026-08-01T03:30:00Z = 2026-08-01 00:30 America/Fortaleza — já é dia 1 no fuso
      // do app. periodoCorrente() passando esse valor já-fusado de volta para
      // getPeriodBounds (que fusa de novo) subtraía mais 3h e caía em 2026-07-31
      // 21:30 — regredindo pra julho e escrevendo a receita de julho no campo de
      // agosto do ClickUp, todo mês, silenciosamente.
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 1, 3, 30, 0)));
      const r = periodoCorrente();
      expect(r.ano).toBe(2026);
      expect(r.mes).toBe(8);
      expect(r.fromDate.toISOString().slice(0, 10)).toBe("2026-08-01");
    });
  });
});

/**
 * A tela de detalhamento (que lista as faturas que somam o valor de um vínculo)
 * reapura o mês a partir do (ano, mes) gravado no ClickUpPushLog, usando
 * `limitesDoMes` — enquanto o push usou `periodoCorrente()`. Se as duas
 * produzirem janelas diferentes, a lista mostra faturas de um recorte que não é
 * o que foi somado, e o total não fecha com o valor exibido. Por isso a
 * equivalência é travada por teste, não confiada.
 */
describe("limitesDoMes (reapuração de um mês já gravado)", () => {
  it("produz EXATAMENTE os mesmos limites que periodoCorrente() para o mesmo mês", () => {
    const referencia = new Date(Date.UTC(2026, 6, 21, 12, 0, 0));
    const corrente = periodoCorrente(referencia);
    const reapurado = limitesDoMes(corrente.ano, corrente.mes);
    expect(reapurado.fromDate.toISOString()).toBe(corrente.fromDate.toISOString());
    expect(reapurado.toDateExclusive.toISOString()).toBe(corrente.toDateExclusive.toISOString());
  });

  it("equivale a periodoCorrente() em todos os 12 meses (inclusive virada de ano)", () => {
    for (let mes = 1; mes <= 12; mes++) {
      const corrente = periodoCorrente(new Date(Date.UTC(2026, mes - 1, 15, 12, 0, 0)));
      const reapurado = limitesDoMes(2026, mes);
      expect(reapurado.fromDate.toISOString()).toBe(corrente.fromDate.toISOString());
      expect(reapurado.toDateExclusive.toISOString()).toBe(corrente.toDateExclusive.toISOString());
    }
  });

  it("dezembro fecha no dia 1º de janeiro do ano seguinte (limite exclusivo)", () => {
    const r = limitesDoMes(2026, 12);
    expect(r.fromDate.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(r.toDateExclusive.toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("mês de um dígito vira chave com zero à esquerda (2026-07, nunca 2026-7)", () => {
    const r = limitesDoMes(2026, 7);
    expect(r.fromDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(r.toDateExclusive.toISOString().slice(0, 10)).toBe("2026-08-01");
  });
});
