import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAutoSyncWindow } from "@/lib/scheduler/auto-sync-window";

describe("computeAutoSyncWindow (janela da sincronização automática — ADR-0013, mês corrente)", () => {
  it("periodoInicio é o dia 1 do mês corrente; periodoFim é a referência exata (não o mês inteiro)", () => {
    // 21/07/2026 12:00 UTC ~ 09:00 America/Fortaleza (UTC-3), mesmo dia-calendário.
    const referencia = new Date(Date.UTC(2026, 6, 21, 12, 0, 0));
    const { periodoInicio, periodoFim } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(periodoFim).toBe(referencia);
  });

  it("no primeiro dia do mês, periodoInicio já é hoje (não o mês anterior)", () => {
    const referencia = new Date(Date.UTC(2026, 7, 1, 14, 0, 0)); // 01/08/2026 11:00 local
    const { periodoInicio } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("dezembro corretamente permanece no mesmo ano (sem cruzar virada de ano)", () => {
    const referencia = new Date(Date.UTC(2026, 11, 15, 12, 0, 0));
    const { periodoInicio } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  describe("caminho de produção (sem referência explícita — regressão de fuso duplo, achada por verificação adversarial)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("logo após a virada do mês (fuso America/Fortaleza, UTC-3), NÃO regride para o mês anterior", () => {
      // 2026-08-01T04:00:00Z = 2026-08-01 01:00 America/Fortaleza — já é dia 1 no fuso do
      // app. Um fuso aplicado DUAS vezes (bug real: computeAutoSyncWindow passando o
      // resultado já-fusado de nowInAppTz() de volta para getPeriodBounds, que fusa de
      // novo) subtraía mais 3h e caía em 2026-07-31 22:00 — regredindo para julho.
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 1, 4, 0, 0)));
      const { periodoInicio } = computeAutoSyncWindow();
      expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
    });
  });
});
