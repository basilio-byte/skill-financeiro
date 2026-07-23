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

  it("usa o grupo INTEIRO (sem exclusividade) quando o desempate por valor não resolve para exatamente 1 — porta exata do script real, não cai para Sem LV por ambiguidade", () => {
    const crA = cr({ id: 10, valorRecebido: money("100") });
    const crB = cr({ id: 11, valorRecebido: money("250") });
    const lvA = lv({ id: 1, valor: money("999") }); // não bate com nenhum dos dois CRs

    const result = joinContasReceberComListarVendas([crA, crB], [lvA]);
    // Nenhum desempate único: AMBAS as faturas usam o item compartilhado inteiro.
    expect(result.find((r) => r.cr.id === 10)!.itensLV.map((l) => l.id)).toEqual([1]);
    expect(result.find((r) => r.cr.id === 11)!.itensLV.map((l) => l.id)).toEqual([1]);
  });

  it("sem exclusividade: um item já usado por uma fatura pode ser usado por outra também, se ambas desempatarem para o mesmo item", () => {
    // Duas faturas do mesmo cliente/mês, ambas com valor_recebido dentro da
    // tolerância do MESMO item LV — o script real não impede que as duas
    // "peguem" o mesmo item de forma exclusiva.
    const crA = cr({ id: 10, valorRecebido: money("100") });
    const crB = cr({ id: 11, valorRecebido: money("100.01") });
    const lvUnico = lv({ id: 1, valor: money("100") });

    const result = joinContasReceberComListarVendas([crA, crB], [lvUnico]);
    expect(result.find((r) => r.cr.id === 10)!.itensLV.map((l) => l.id)).toEqual([1]);
    expect(result.find((r) => r.cr.id === 11)!.itensLV.map((l) => l.id)).toEqual([1]);
  });

  it("Cliente ID nulo TAMBÉM entra na chave e pode colidir — porta exata do dict do Python sem guarda contra None (decisão de fidelidade, auditoria 2026-07-23)", () => {
    const crSemCliente = cr({ clienteId: null, competencia: new Date(Date.UTC(2026, 6, 1)) });
    const lvSemCliente = lv({ clienteId: null, referenciaCobranca: new Date(Date.UTC(2026, 6, 15)) });

    const result = joinContasReceberComListarVendas([crSemCliente], [lvSemCliente]);
    // Antes desta decisão, isso caía em Sem LV incondicionalmente. Agora casa,
    // igual ao Python (cliente_id=None em ambos os lados colide na chave).
    expect(result[0]!.itensLV.map((l) => l.id)).toEqual([1]);
  });

  it("tolerância de desempate é ESTRITA (< 0,02, não <=) — diferença exata de 2 centavos NÃO desempata", () => {
    const crA = cr({ id: 10, valorRecebido: money("100") });
    // Diferença EXATA de 2 centavos (não deve contar como match, pois é < 0.02, não <=).
    const lvNaBorda = lv({ id: 1, valor: money("100.02") });
    const lvOutro = lv({ id: 2, valor: money("500") });

    const result = joinContasReceberComListarVendas([crA], [lvNaBorda, lvOutro]);
    // Se a tolerância fosse <=, desempataria para [1] só. Sendo estrita (<),
    // nenhum item bate sozinho -> usa o grupo INTEIRO (os dois itens).
    expect(result[0]!.itensLV.map((l) => l.id).sort()).toEqual([1, 2]);
  });
});
