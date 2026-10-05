import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { ImportacaoInvalidaError } from "@/lib/categorization/validar-exports";
import { montarAlertas, quedaPercentual, validarPeriodo } from "@/lib/categorization/importacao-regras";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const base = {
  inicio: d("2026-09-01"),
  fim: d("2026-09-30"),
  hoje: d("2026-10-05"),
  faturasAceitas: 600,
  conferencia: money(0),
  removidas: 0,
  removidasValor: money(0),
  preservadasPorRevisao: 0,
  semCategoria: { linhas: 0, total: money(0) },
  meses: [{ mes: "2026-09", antes: money("347554.71"), depois: money("350000.00"), quedaPct: -0.7 }],
};

describe("validarPeriodo", () => {
  it("aceita um mês", () => {
    expect(() => validarPeriodo(d("2026-09-01"), d("2026-09-30"))).not.toThrow();
  });
  it("recusa início depois do fim", () => {
    expect(() => validarPeriodo(d("2026-09-30"), d("2026-09-01"))).toThrow(ImportacaoInvalidaError);
  });
  it("recusa data inválida", () => {
    expect(() => validarPeriodo(new Date("x"), d("2026-09-01"))).toThrow(/inválidas/);
  });
  it("recusa janela absurda (provável erro de digitação do ano)", () => {
    expect(() => validarPeriodo(d("2020-01-01"), d("2026-09-30"))).toThrow(/mais de 400 dias/);
  });
});

describe("quedaPercentual", () => {
  it("calcula a queda", () => {
    expect(quedaPercentual(money(1000), money(900))).toBe(10);
  });
  it("aumento vira valor negativo", () => {
    expect(quedaPercentual(money(1000), money(1100))).toBe(-10);
  });
  it("sem nada antes não há percentual", () => {
    expect(quedaPercentual(money(0), money(500))).toBeNull();
  });
});

describe("montarAlertas", () => {
  it("importação limpa de mês inteiro não gera alerta", () => {
    expect(montarAlertas(base)).toEqual([]);
  });

  it("nenhuma fatura aceita BLOQUEIA", () => {
    const a = montarAlertas({ ...base, faturasAceitas: 0 });
    expect(a.some((x) => x.nivel === "bloqueio" && /Nenhuma fatura/.test(x.texto))).toBe(true);
  });

  it("conferência diferente de zero BLOQUEIA", () => {
    const a = montarAlertas({ ...base, conferencia: money("0.50") });
    expect(a.find((x) => x.nivel === "bloqueio")?.texto).toMatch(/conferência da skill não fechou/);
  });

  it("linhas removidas são anunciadas com o valor", () => {
    const a = montarAlertas({ ...base, removidas: 3, removidasValor: money("1234.50") });
    expect(a.find((x) => /REMOVIDAS/.test(x.texto))?.texto).toMatch(/3 linha\(s\).*1\.234,50/);
  });

  it("queda acima do limite é avisada; abaixo, não", () => {
    const grande = montarAlertas({ ...base, meses: [{ ...base.meses[0]!, quedaPct: 12.5 }] });
    expect(grande.some((x) => /cai 12,5%/.test(x.texto))).toBe(true);
    const pequena = montarAlertas({ ...base, meses: [{ ...base.meses[0]!, quedaPct: 4.9 }] });
    expect(pequena).toEqual([]);
  });

  it("avisa de revisão manual preservada, Sem Categoria, fim no futuro e meio mês", () => {
    const a = montarAlertas({
      ...base,
      inicio: d("2026-09-10"),
      fim: d("2026-10-31"),
      preservadasPorRevisao: 2,
      semCategoria: { linhas: 4, total: money("80.00") },
    });
    const t = a.map((x) => x.texto).join("\n");
    expect(t).toMatch(/PRESERVADAS/);
    expect(t).toMatch(/Sem Categoria/);
    expect(t).toMatch(/depois de hoje/);
    expect(t).toMatch(/não começa no dia 1º/);
  });

  it("mês fechado terminando no último dia não acusa meio mês", () => {
    const a = montarAlertas({ ...base, inicio: d("2026-02-01"), fim: d("2026-02-28") });
    expect(a).toEqual([]);
  });

  it("período em andamento (termina hoje) não acusa 'não termina no último dia'", () => {
    const a = montarAlertas({ ...base, inicio: d("2026-10-01"), fim: d("2026-10-05"), hoje: d("2026-10-05") });
    expect(a.some((x) => /último dia/.test(x.texto))).toBe(false);
  });
});
