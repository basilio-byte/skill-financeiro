import { describe, expect, it } from "vitest";
import { joinContasReceberComListarVendas } from "@/lib/categorization/join";
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

describe("joinContasReceberComListarVendas", () => {
  it("cruza CR único com os itens LV do mesmo cliente/mês", () => {
    const result = joinContasReceberComListarVendas([cr()], [lv({ id: 1 }), lv({ id: 2 })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.itensLV.map((l) => l.id)).toEqual([1, 2]);
  });

  it("marca Sem LV quando não há item no mesmo cliente/mês", () => {
    const result = joinContasReceberComListarVendas(
      [cr()],
      [lv({ referenciaCobranca: new Date(Date.UTC(2026, 8, 1)) })], // mês diferente
    );
    expect(result[0]!.itensLV).toEqual([]);
  });

  it("marca Sem LV quando o cliente não tem competência", () => {
    const result = joinContasReceberComListarVendas([cr({ competencia: null })], [lv()]);
    expect(result[0]!.itensLV).toEqual([]);
  });

  it("desempata por valor quando múltiplos CRs compartilham cliente/mês", () => {
    const crA = cr({ id: 10, valorRecebido: money("100") });
    const crB = cr({ id: 11, valorRecebido: money("250") });
    const lvA = lv({ id: 1, valor: money("100.01") }); // dentro da tolerância de R$0,02
    const lvB = lv({ id: 2, valor: money("250") });

    const result = joinContasReceberComListarVendas([crA, crB], [lvA, lvB]);

    const forA = result.find((r) => r.cr.id === 10)!;
    const forB = result.find((r) => r.cr.id === 11)!;
    expect(forA.itensLV.map((l) => l.id)).toEqual([1]);
    expect(forB.itensLV.map((l) => l.id)).toEqual([2]);
  });

  it("cai para Sem LV quando o desempate por valor é ambíguo (nenhum item bate)", () => {
    const crA = cr({ id: 10, valorRecebido: money("100") });
    const crB = cr({ id: 11, valorRecebido: money("250") });
    const lvA = lv({ id: 1, valor: money("999") }); // não bate com nenhum dos dois CRs

    const result = joinContasReceberComListarVendas([crA, crB], [lvA]);
    expect(result.find((r) => r.cr.id === 10)!.itensLV).toEqual([]);
    expect(result.find((r) => r.cr.id === 11)!.itensLV).toEqual([]);
  });
});
