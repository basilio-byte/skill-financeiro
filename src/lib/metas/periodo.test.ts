import { describe, expect, it } from "vitest";
import { getPeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, mesDaData, mesesDoPeriodo, periodoAceitaMeta } from "@/lib/metas/periodo";

/**
 * `mesesDoPeriodo` decide QUANTAS metas mensais são somadas. Um mês a mais
 * infla a meta do trimestre em ~33% e faz o Panorama mostrar a equipe como
 * atrasada sem motivo; um a menos faz o contrário. Nada disso dá erro visível,
 * então tem que estar coberto por teste.
 */
describe("mesesDoPeriodo", () => {
  it("mês devolve exatamente um mês", () => {
    expect(mesesDoPeriodo(getPeriodBounds("month", "2026-07-01"))).toEqual(["2026-07"]);
  });

  it("trimestre devolve exatamente os 3 meses", () => {
    expect(mesesDoPeriodo(getPeriodBounds("quarter", "2026-07-01"))).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("semestre devolve exatamente os 6 meses", () => {
    expect(mesesDoPeriodo(getPeriodBounds("semester", "2026-01-01"))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("ano devolve 12 meses, de janeiro a dezembro", () => {
    const meses = mesesDoPeriodo(getPeriodBounds("year", "2026-01-01"));
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe("2026-01");
    expect(meses[11]).toBe("2026-12");
  });

  it("não inclui o mês seguinte por causa do limite exclusivo", () => {
    // Dezembro termina em 01/01 00:00 do ano seguinte: janeiro NÃO entra.
    const meses = mesesDoPeriodo(getPeriodBounds("month", "2026-12-01"));
    expect(meses).toEqual(["2026-12"]);
  });

  it("período que cruza o ano não perde nem duplica mês", () => {
    const meses = mesesDoPeriodo(getPeriodBounds("quarter", "2026-10-01"));
    expect(meses).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("semana pode devolver dois meses quando cruza a virada", () => {
    // Não é usado para somar meta (semana não aceita meta), mas a função não
    // pode quebrar nem inventar meses se for chamada.
    const meses = mesesDoPeriodo(getPeriodBounds("week", "2026-07-29"));
    expect(meses.length).toBeGreaterThanOrEqual(1);
    expect(new Set(meses).size).toBe(meses.length); // sem duplicatas
  });
});

describe("periodoAceitaMeta", () => {
  it("aceita mês e agregados maiores", () => {
    expect(periodoAceitaMeta("month")).toBe(true);
    expect(periodoAceitaMeta("quarter")).toBe(true);
    expect(periodoAceitaMeta("semester")).toBe(true);
    expect(periodoAceitaMeta("year")).toBe(true);
  });

  it("recusa dia e semana — ratear meta mensal inventaria número", () => {
    expect(periodoAceitaMeta("day")).toBe(false);
    expect(periodoAceitaMeta("week")).toBe(false);
  });
});

describe("mesDaData", () => {
  it("formata em yyyy-MM com zero à esquerda", () => {
    expect(mesDaData(new Date("2026-03-09T00:00:00Z"))).toBe("2026-03");
    expect(mesDaData(new Date("2026-11-30T00:00:00Z"))).toBe("2026-11");
  });

  it("usa UTC — o primeiro dia do mês não escorrega para o mês anterior", () => {
    // dataCredito é @db.Date (meia-noite UTC). Ler em fuso local negativo
    // devolveria o dia anterior, jogando a receita para o mês errado.
    expect(mesDaData(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07");
  });
});

describe("fracaoDecorrida", () => {
  const julho = getPeriodBounds("month", "2026-07-01");

  it("devolve null para período já encerrado", () => {
    expect(fracaoDecorrida(julho, new Date("2026-09-01T12:00:00Z"))).toBeNull();
  });

  it("devolve null para período futuro", () => {
    expect(fracaoDecorrida(julho, new Date("2026-05-01T12:00:00Z"))).toBeNull();
  });

  it("devolve fração entre 0 e 1 no meio do período", () => {
    const f = fracaoDecorrida(julho, new Date("2026-07-16T12:00:00Z"));
    expect(f).not.toBeNull();
    expect(f!).toBeGreaterThan(0.4);
    expect(f!).toBeLessThan(0.6);
  });

  it("é ~0 no primeiro instante do período", () => {
    const f = fracaoDecorrida(julho, julho.fromDate);
    expect(f).toBe(0);
  });
});
