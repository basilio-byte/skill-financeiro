import { describe, expect, it } from "vitest";
import { parseContasReceberRows, parseFlexibleDate, yearMonthKey } from "@/lib/categorization/parse-exports";

const JULHO_INICIO = new Date(Date.UTC(2026, 6, 1));
const JULHO_FIM = new Date(Date.UTC(2026, 6, 22));

function linhaBase(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ID: "1",
    Unidade: "SEAHUB COWORKING",
    Faturamento: "Pix",
    "ID Cliente": "100",
    "CPF/CNPJ": "",
    "Razão Social Cliente": "Cliente Teste",
    "Plano(s) Contratado(s)": "Plano Teste",
    Tipo: "Contratual",
    Status: "Quitada",
    Parcela: "1 de 1",
    "Valor Bruto": "100,00",
    "Valor Recebido": "100,00",
    "Valor Desconto": "0,00",
    ...overrides,
  };
}

describe("parseFlexibleDate", () => {
  it("aceita dd/mm/yyyy", () => {
    expect(parseFlexibleDate("13/07/2026")).toEqual(new Date(Date.UTC(2026, 6, 13)));
  });

  it("aceita yyyy-mm-dd", () => {
    expect(parseFlexibleDate("2026-07-13")).toEqual(new Date(Date.UTC(2026, 6, 13)));
  });

  it("rejeita data com hora anexada — porta exata do strptime rígido do Python (auditoria 2026-07-23)", () => {
    expect(parseFlexibleDate("13/07/2026 17:08:35")).toBeNull();
  });

  it("corta por vírgula antes do parse (porta exata de norm_comp/parse_date, auditoria 2026-07-23)", () => {
    expect(parseFlexibleDate("13/07/2026, 14/08/2026")).toEqual(new Date(Date.UTC(2026, 6, 13)));
  });

  it("aceita dia/mês com 1 dígito, igual ao strptime do Python", () => {
    expect(parseFlexibleDate("1/7/2026")).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(parseFlexibleDate("2026-7-1")).toEqual(new Date(Date.UTC(2026, 6, 1)));
  });
});

describe("parseContasReceberRows — Data Crédito como lista (ADR-0018, porta exata de categoriza_receita.py)", () => {
  it("data única DENTRO do período: inclui normalmente", () => {
    const [r] = parseContasReceberRows([linhaBase({ "Data Crédito": "13/07/2026" })], JULHO_INICIO, JULHO_FIM);
    expect(r!.dataCredito).toEqual(new Date(Date.UTC(2026, 6, 13)));
  });

  it("data única FORA do período: dataCredito null (fatura deve ser excluída pelo chamador)", () => {
    const [r] = parseContasReceberRows([linhaBase({ "Data Crédito": "05/08/2026" })], JULHO_INICIO, JULHO_FIM);
    expect(r!.dataCredito).toBeNull();
  });

  it("lista de datas com UMA delas no período: usa a que bate, não a primeira da lista", () => {
    // Réplica do caso real encontrado (fatura parcelada): primeira data é
    // junho (fora do período), mas a segunda (julho) está dentro.
    const [r] = parseContasReceberRows(
      [linhaBase({ "Data Crédito": "11/06/2026, 13/07/2026, 10/08/2026" })],
      JULHO_INICIO,
      JULHO_FIM,
    );
    expect(r!.dataCredito).toEqual(new Date(Date.UTC(2026, 6, 13)));
  });

  it("lista de datas SEM NENHUMA no período: dataCredito null", () => {
    const [r] = parseContasReceberRows(
      [linhaBase({ "Data Crédito": "11/06/2026, 10/08/2026, 07/01/2027" })],
      JULHO_INICIO,
      JULHO_FIM,
    );
    expect(r!.dataCredito).toBeNull();
  });

  it("data igual ao primeiro dia do período: inclusive", () => {
    const [r] = parseContasReceberRows([linhaBase({ "Data Crédito": "01/07/2026" })], JULHO_INICIO, JULHO_FIM);
    expect(r!.dataCredito).toEqual(JULHO_INICIO);
  });

  it("data igual ao último dia do período: inclusive", () => {
    const [r] = parseContasReceberRows([linhaBase({ "Data Crédito": "22/07/2026" })], JULHO_INICIO, JULHO_FIM);
    expect(r!.dataCredito).toEqual(JULHO_FIM);
  });

  it("sem Data Crédito nenhuma: null", () => {
    const [r] = parseContasReceberRows([linhaBase({ "Data Crédito": "" })], JULHO_INICIO, JULHO_FIM);
    expect(r!.dataCredito).toBeNull();
  });

  it("única data do período vem com hora anexada: fatura fica de fora, igual ao strptime rígido do Python (auditoria 2026-07-23)", () => {
    const [r] = parseContasReceberRows(
      [linhaBase({ "Data Crédito": "13/07/2026 17:08:35" })],
      JULHO_INICIO,
      JULHO_FIM,
    );
    expect(r!.dataCredito).toBeNull();
  });
});

describe("yearMonthKey", () => {
  it("formata yyyy-mm", () => {
    expect(yearMonthKey(new Date(Date.UTC(2026, 6, 13)))).toBe("2026-07");
  });

  it("null para data nula", () => {
    expect(yearMonthKey(null)).toBeNull();
  });
});
