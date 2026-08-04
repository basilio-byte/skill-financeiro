import { describe, expect, it } from "vitest";
import { mesDoCredito, mesesNoIntervalo } from "@/lib/categorization/mes-credito";

describe("mesDoCredito", () => {
  it("formata em yyyy-MM com zero à esquerda", () => {
    expect(mesDoCredito(new Date(Date.UTC(2026, 6, 15)))).toBe("2026-07");
    expect(mesDoCredito(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
    expect(mesDoCredito(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("lê em UTC — dia 1º não escorrega para o mês anterior em fuso negativo", () => {
    // ESTE é o teste que importa. `dataCredito` é @db.Date e chega como
    // meia-noite UTC; lido no fuso do app (America/Fortaleza, UTC−3) o dia 1º
    // vira o último dia do mês ANTERIOR. Como o mês faz parte da IDENTIDADE da
    // linha, esse erro não mostraria número errado — criaria linha duplicada.
    const primeiroDeAgosto = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01T00:00:00Z
    expect(mesDoCredito(primeiroDeAgosto)).toBe("2026-08");
    expect(primeiroDeAgosto.toISOString().slice(0, 7)).toBe("2026-08");
  });

  it("é estável para as datas reais que causaram o incidente", () => {
    // As 10 faturas da ADR-0029 migraram para 01–04/08. Se qualquer uma delas
    // fosse lida como julho, a correção não separaria os meses.
    for (const dia of [1, 2, 3, 4]) {
      expect(mesDoCredito(new Date(Date.UTC(2026, 7, dia)))).toBe("2026-08");
    }
    expect(mesDoCredito(new Date(Date.UTC(2026, 6, 31)))).toBe("2026-07");
  });
});

describe("mesesNoIntervalo", () => {
  it("intervalo dentro de um mês devolve só aquele mês", () => {
    expect(mesesNoIntervalo(new Date(Date.UTC(2026, 6, 1)), new Date(Date.UTC(2026, 6, 31)))).toEqual(["2026-07"]);
  });

  it("intervalo que cruza meses devolve todos, em ordem", () => {
    expect(mesesNoIntervalo(new Date(Date.UTC(2026, 5, 15)), new Date(Date.UTC(2026, 7, 4)))).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("atravessa a virada de ano sem pular mês", () => {
    expect(mesesNoIntervalo(new Date(Date.UTC(2026, 10, 20)), new Date(Date.UTC(2027, 1, 3)))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("não pula fevereiro nem se apoia em 'somar 30 dias'", () => {
    // Caminhar por dias somados quebraria em fevereiro; o cursor incrementa o
    // MÊS, então 31/01 → 28/02 não some.
    expect(mesesNoIntervalo(new Date(Date.UTC(2026, 0, 31)), new Date(Date.UTC(2026, 2, 1)))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("fim antes do início devolve lista vazia, sem laço infinito", () => {
    expect(mesesNoIntervalo(new Date(Date.UTC(2026, 6, 10)), new Date(Date.UTC(2026, 5, 1)))).toEqual([]);
  });

  it("mesmo instante nos dois lados devolve um mês", () => {
    const d = new Date(Date.UTC(2026, 6, 10, 13, 45));
    expect(mesesNoIntervalo(d, d)).toEqual(["2026-07"]);
  });
});
