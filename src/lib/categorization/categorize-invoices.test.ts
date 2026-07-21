import { describe, expect, it } from "vitest";
import { categorizeInvoices } from "@/lib/categorization/categorize-invoices";
import { money } from "@/lib/money";
import type { ContasReceberRow, ListarVendasRow } from "@/lib/categorization/types";

function cr(overrides: Partial<ContasReceberRow> = {}): ContasReceberRow {
  return {
    id: 1,
    unidade: "SEAHUB COWORKING",
    faturamento: "Pix",
    clienteId: 100,
    cpfCnpj: "",
    razaoSocial: "Cliente Teste",
    planoContratado: "Plano Teste",
    tipo: "Contratual",
    status: "Quitada",
    parcela: "1 de 1",
    valorBruto: money("100"),
    valorRecebido: money("100"),
    valorDesconto: money("0"),
    vencimento: null,
    quitacao: null,
    competencia: new Date(Date.UTC(2026, 6, 1)),
    emissao: null,
    dataCredito: null,
    conta: "",
    observacoes: "",
    tags: "",
    raw: {},
    ...overrides,
  };
}

function lv(overrides: Partial<ListarVendasRow> = {}): ListarVendasRow {
  return {
    id: 1,
    clienteId: 100,
    servicoItem: "Serviço Teste",
    categoriaConexa: "",
    data: new Date(Date.UTC(2026, 6, 15)),
    valor: money("100"),
    valorDesconto: money("0"),
    status: "Quitada",
    referenciaCobranca: new Date(Date.UTC(2026, 6, 20)),
    raw: {},
    ...overrides,
  };
}

describe("categorizeInvoices", () => {
  it("categoria única -> Proporcionado N, valor integral", () => {
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("100") })],
      [lv({ servicoItem: "Sala A" })],
      [{ nome: "Sala A", categoria: "Salas Privativas" }],
    );
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]).toMatchObject({
      categoria: "Salas Privativas",
      proporcionado: "N",
      valorRecebidoCategoria: expect.anything(),
    });
    expect(resultado.linhas[0]!.valorRecebidoCategoria.toString()).toBe("100");
  });

  it("sem itens LV -> Proporcionado SEM_LV, categoriza pelo plano contratado", () => {
    const resultado = categorizeInvoices(
      [cr({ planoContratado: "Plano X", valorRecebido: money("50") })],
      [],
      [{ nome: "Plano X", categoria: "Categoria X" }],
    );
    expect(resultado.linhas[0]).toMatchObject({ categoria: "Categoria X", proporcionado: "SEM_LV" });
    expect(resultado.totalSemLV).toBe(1);
  });

  it("múltiplas categorias na mesma fatura -> rateio proporcional (Proporcionado S) e soma fecha exata", () => {
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("100") })],
      [
        lv({ id: 1, servicoItem: "Sala A", valor: money("70") }),
        lv({ id: 2, servicoItem: "Sala B", valor: money("30") }),
      ],
      [
        { nome: "Sala A", categoria: "Categoria A" },
        { nome: "Sala B", categoria: "Categoria B" },
      ],
    );
    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.linhas.every((l) => l.proporcionado === "S")).toBe(true);
    const soma = resultado.linhas.reduce((acc, l) => acc.plus(l.valorRecebidoCategoria), money("0"));
    expect(soma.toString()).toBe("100");
  });

  it("registra serviços sem categoria em servicosNaoMapeados", () => {
    const resultado = categorizeInvoices([cr()], [lv({ servicoItem: "Serviço Desconhecido" })], []);
    expect(resultado.servicosNaoMapeados).toContain("Serviço Desconhecido");
  });
});
