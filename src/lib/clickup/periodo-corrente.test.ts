import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { periodoCorrente } from "@/lib/clickup/periodo-corrente";

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
