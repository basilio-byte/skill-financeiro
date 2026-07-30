import { describe, expect, it } from "vitest";
import { comInicialMaiuscula, getPeriodBounds, shiftPeriodKey } from "@/lib/dates";

describe("getPeriodBounds", () => {
  it("dia: fromKey e toKey são o mesmo dia da referência", () => {
    const b = getPeriodBounds("day", "2026-07-21");
    expect(b.fromKey).toBe("2026-07-21");
    expect(b.toKey).toBe("2026-07-21");
    expect(b.toDateExclusive.toISOString().slice(0, 10)).toBe("2026-07-22");
  });

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
  it("dia: +1/-1 navegam um dia, cruzando virada de mês corretamente", () => {
    expect(shiftPeriodKey("2026-07-31", "day", 1)).toBe("2026-08-01");
    expect(shiftPeriodKey("2026-08-01", "day", -1)).toBe("2026-07-31");
  });

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

describe("comInicialMaiuscula", () => {
  // Os rótulos abaixo NÃO são inventados: são os formatos que
  // formatPeriodLabel() produz de fato para cada PeriodKind. Se alguém mudar o
  // formato, este teste é o lugar onde a mudança aparece.
  it("mês: maiúscula na primeira letra", () => {
    expect(comInicialMaiuscula("julho de 2026")).toBe("Julho de 2026");
  });

  it("trimestre: pula o dígito E o ordinal 'º', que É letra Unicode sem maiúscula", () => {
    // A armadilha real desta função: /\p{L}/ casa com "º" (categoria Lo) e
    // toUpperCase("º") === "º", então uma implementação por \p{L} devolveria a
    // string intacta e o trimestral ficaria minúsculo ao lado do mensal.
    expect(comInicialMaiuscula("3º trimestre de 2026")).toBe("3º Trimestre de 2026");
    expect(comInicialMaiuscula("1º semestre de 2026")).toBe("1º Semestre de 2026");
  });

  it("limitação conhecida e aceita: no formato de DIA a primeira letra é o 'd' de 'de'", () => {
    // Documentado, não desejado. Nenhum título usa o rótulo de dia hoje (o card
    // de Metas nem existe em visão diária). Se um dia usar, trate lá — este
    // teste é o aviso de que o resultado seria este.
    expect(comInicialMaiuscula("30 de julho de 2026")).toBe("30 De julho de 2026");
  });

  it("rótulos sem nenhuma letra voltam intactos, sem estourar", () => {
    expect(comInicialMaiuscula("2026")).toBe("2026");
    expect(comInicialMaiuscula("27/07 – 02/08/2026")).toBe("27/07 – 02/08/2026");
    expect(comInicialMaiuscula("")).toBe("");
  });

  it("idempotente — aplicar duas vezes não maiúscula a SEGUNDA letra", () => {
    // Este teste existe porque a primeira implementação buscava "o primeiro
    // caractere que muda ao virar maiúsculo", ou seja a primeira MINÚSCULA:
    // em "Julho de 2026" isso é o "u", e o resultado era "JUlho de 2026".
    expect(comInicialMaiuscula(comInicialMaiuscula("julho de 2026"))).toBe("Julho de 2026");
    expect(comInicialMaiuscula("Julho de 2026")).toBe("Julho de 2026");
    expect(comInicialMaiuscula("3º Trimestre de 2026")).toBe("3º Trimestre de 2026");
  });
});
