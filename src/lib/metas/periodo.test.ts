import { describe, expect, it } from "vitest";
import { getPeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, trimestreDaData, trimestresDoPeriodo, periodoAceitaMeta } from "@/lib/metas/periodo";

/**
 * `trimestresDoPeriodo` decide QUANTAS metas trimestrais são somadas. Um
 * trimestre a mais infla a meta do ano em 25% e faz o Panorama mostrar a
 * equipe como atrasada sem motivo; um a menos faz o contrário. Nada disso dá
 * erro visível, então tem que estar coberto por teste.
 */
describe("trimestresDoPeriodo", () => {
  it("trimestre devolve exatamente um trimestre", () => {
    expect(trimestresDoPeriodo(getPeriodBounds("quarter", "2026-07-01"))).toEqual(["2026-Q3"]);
  });

  it("semestre devolve exatamente os 2 trimestres", () => {
    expect(trimestresDoPeriodo(getPeriodBounds("semester", "2026-01-01"))).toEqual(["2026-Q1", "2026-Q2"]);
  });

  it("segundo semestre devolve Q3 e Q4", () => {
    expect(trimestresDoPeriodo(getPeriodBounds("semester", "2026-07-01"))).toEqual(["2026-Q3", "2026-Q4"]);
  });

  it("ano devolve os 4 trimestres, de Q1 a Q4", () => {
    const trimestres = trimestresDoPeriodo(getPeriodBounds("year", "2026-01-01"));
    expect(trimestres).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  });

  it("não inclui o trimestre seguinte por causa do limite exclusivo", () => {
    // Q4 termina em 01/01 00:00 do ano seguinte: Q1 do ano seguinte NÃO entra.
    const trimestres = trimestresDoPeriodo(getPeriodBounds("quarter", "2026-10-01"));
    expect(trimestres).toEqual(["2026-Q4"]);
  });

  it("período que cruza o ano não perde nem duplica trimestre", () => {
    const trimestres = trimestresDoPeriodo(getPeriodBounds("year", "2025-01-01"));
    expect(trimestres).toHaveLength(4);
    expect(new Set(trimestres).size).toBe(4);
  });

  it("mês pode devolver o trimestre que o contém, mesmo não sendo o átomo aceito", () => {
    // Não é usado para somar meta (mês não aceita meta), mas a função não pode
    // quebrar nem inventar trimestres se for chamada.
    const trimestres = trimestresDoPeriodo(getPeriodBounds("month", "2026-07-01"));
    expect(trimestres).toEqual(["2026-Q3"]);
  });
});

describe("periodoAceitaMeta", () => {
  it("aceita trimestre e agregados maiores", () => {
    expect(periodoAceitaMeta("quarter")).toBe(true);
    expect(periodoAceitaMeta("semester")).toBe(true);
    expect(periodoAceitaMeta("year")).toBe(true);
  });

  it("recusa dia, semana e mês — ratear meta trimestral inventaria número", () => {
    expect(periodoAceitaMeta("day")).toBe(false);
    expect(periodoAceitaMeta("week")).toBe(false);
    expect(periodoAceitaMeta("month")).toBe(false);
  });
});

describe("trimestreDaData", () => {
  it("formata em yyyy-Q# — mês 0 (janeiro) é Q1", () => {
    expect(trimestreDaData(new Date("2026-01-15T00:00:00Z"))).toBe("2026-Q1");
  });

  it("mês 3 (abril) é Q2", () => {
    expect(trimestreDaData(new Date("2026-04-01T00:00:00Z"))).toBe("2026-Q2");
  });

  it("mês 8 (setembro) é Q3", () => {
    expect(trimestreDaData(new Date("2026-09-30T00:00:00Z"))).toBe("2026-Q3");
  });

  it("mês 11 (dezembro) é Q4", () => {
    expect(trimestreDaData(new Date("2026-12-01T00:00:00Z"))).toBe("2026-Q4");
  });

  it("usa UTC — o primeiro dia do trimestre não escorrega para o anterior", () => {
    // dataCredito é @db.Date (meia-noite UTC). Ler em fuso local negativo
    // devolveria o dia anterior, jogando a receita para o trimestre errado.
    expect(trimestreDaData(new Date("2026-07-01T00:00:00Z"))).toBe("2026-Q3");
  });
});

describe("fracaoDecorrida", () => {
  const q3 = getPeriodBounds("quarter", "2026-07-01");

  it("devolve null para período já encerrado", () => {
    expect(fracaoDecorrida(q3, new Date("2026-11-01T12:00:00Z"))).toBeNull();
  });

  it("devolve null para período futuro", () => {
    expect(fracaoDecorrida(q3, new Date("2026-05-01T12:00:00Z"))).toBeNull();
  });

  it("devolve fração entre 0 e 1 no meio do período", () => {
    const f = fracaoDecorrida(q3, new Date("2026-08-15T12:00:00Z"));
    expect(f).not.toBeNull();
    expect(f!).toBeGreaterThan(0.4);
    expect(f!).toBeLessThan(0.6);
  });

  it("é ~0 no primeiro instante do período", () => {
    const f = fracaoDecorrida(q3, q3.fromDate);
    expect(f).toBe(0);
  });
});
