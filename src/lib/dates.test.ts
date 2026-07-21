import { describe, expect, it } from "vitest";
import { getPeriodBounds, shiftPeriodKey } from "@/lib/dates";

describe("getPeriodBounds", () => {
  it("mês: janeiro inteiro a partir de qualquer dia do mês", () => {
    const b = getPeriodBounds("month", "2026-01-15");
    expect(b.fromKey).toBe("2026-01-01");
    expect(b.toKey).toBe("2026-01-31");
  });

  it("mês: NÃO desliza um dia para trás ao usar ref=01/01 (regressão de fuso)", () => {
    const b = getPeriodBounds("month", "2026-01-01");
    expect(b.fromKey).toBe("2026-01-01");
    expect(b.label).toMatch(/janeiro de 2026/i);
  });

  it("semana: começa na segunda-feira", () => {
    // 2026-07-22 é uma quarta-feira
    const b = getPeriodBounds("week", "2026-07-22");
    expect(b.fromKey).toBe("2026-07-20"); // segunda
    expect(b.toKey).toBe("2026-07-26"); // domingo
  });

  it("trimestre: julho cai no 3º trimestre (jul-set)", () => {
    const b = getPeriodBounds("quarter", "2026-07-21");
    expect(b.fromKey).toBe("2026-07-01");
    expect(b.toKey).toBe("2026-09-30");
    expect(b.label).toContain("3º trimestre");
  });

  it("semestre: julho cai no 2º semestre", () => {
    const b = getPeriodBounds("semester", "2026-07-21");
    expect(b.fromKey).toBe("2026-07-01");
    expect(b.toKey).toBe("2026-12-31");
    expect(b.label).toContain("2º semestre");
  });

  it("semestre: fevereiro cai no 1º semestre", () => {
    const b = getPeriodBounds("semester", "2026-02-10");
    expect(b.fromKey).toBe("2026-01-01");
    expect(b.toKey).toBe("2026-06-30");
  });

  it("ano: limites são 01/01 e 31/12", () => {
    const b = getPeriodBounds("year", "2026-07-21");
    expect(b.fromKey).toBe("2026-01-01");
    expect(b.toKey).toBe("2026-12-31");
  });

  it("toDateExclusive é o dia seguinte ao toKey (comparação lt exclusiva)", () => {
    const b = getPeriodBounds("month", "2026-02-10");
    expect(b.toKey).toBe("2026-02-28");
    expect(b.toDateExclusive.toISOString().slice(0, 10)).toBe("2026-03-01");
  });
});

describe("shiftPeriodKey", () => {
  it("mês: -1 cruza a virada de ano corretamente", () => {
    expect(shiftPeriodKey("2026-01-01", "month", -1)).toBe("2025-12-01");
  });

  it("trimestre: +1 avança 3 meses", () => {
    expect(shiftPeriodKey("2026-01-01", "quarter", 1)).toBe("2026-04-01");
  });

  it("semestre: +1 avança 6 meses", () => {
    expect(shiftPeriodKey("2026-01-01", "semester", 1)).toBe("2026-07-01");
  });

  it("ano: -1 volta um ano", () => {
    expect(shiftPeriodKey("2026-07-21", "year", -1)).toBe("2025-07-21");
  });
});
