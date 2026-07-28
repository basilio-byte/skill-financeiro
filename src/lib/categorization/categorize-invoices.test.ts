import { describe, expect, it } from "vitest";
import { categorizeInvoices, chaveLinhaDoBucket } from "@/lib/categorization/categorize-invoices";
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

  it("empate exato de arredondamento (split 50/50) usa HALF_EVEN, igual ao round() do Python — decisão de fidelidade da auditoria 2026-07-23", () => {
    // valorRecebido=5.35, dois itens de valor_bruto=10 cada (peso 0.5/0.5).
    // Decimal exato: 5.35*0.5 = 2.675 — empate exato de centavo.
    // HALF_EVEN arredonda pro dígito par: 2.68 (8 é par). Os dois itens saem
    // iguais (2.68/2.68), soma=5.36, resíduo=-0.01 aplicado ao ÚLTIMO bucket
    // (ordem de primeira aparição) -> A=2.68, B=2.67.
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("5.35") })],
      [
        lv({ id: 1, servicoItem: "Sala A", valor: money("10") }),
        lv({ id: 2, servicoItem: "Sala B", valor: money("10") }),
      ],
      [
        { nome: "Sala A", categoria: "Categoria A" },
        { nome: "Sala B", categoria: "Categoria B" },
      ],
    );
    const porCategoria = new Map(resultado.linhas.map((l) => [l.categoria, l.valorRecebidoCategoria.toString()]));
    expect(porCategoria.get("Categoria A")).toBe("2.68");
    expect(porCategoria.get("Categoria B")).toBe("2.67");
    const soma = resultado.linhas.reduce((acc, l) => acc.plus(l.valorRecebidoCategoria), money("0"));
    expect(soma.toString()).toBe("5.35");
  });

  it("registra serviços sem categoria em servicosNaoMapeados", () => {
    const resultado = categorizeInvoices([cr()], [lv({ servicoItem: "Serviço Desconhecido" })], []);
    expect(resultado.servicosNaoMapeados).toContain("Serviço Desconhecido");
  });

  describe("chaveLinha (identidade estável do bucket para upsert entre rodadas — ADR-0013)", () => {
    it("chaveLinha é sempre a categoria pura (porta exata do script real, ADR-0018)", () => {
      expect(chaveLinhaDoBucket("Salas Privativas")).toBe("Salas Privativas");
      expect(chaveLinhaDoBucket("Sem Categoria")).toBe("Sem Categoria");
    });

    it("dois serviços não mapeados na mesma fatura se FUNDEM numa única linha 'Sem Categoria' — replica by_cat[cat] += val e '; '.join(...) do Python", () => {
      const resultado = categorizeInvoices(
        [cr({ valorRecebido: money("100") })],
        [
          lv({ id: 1, servicoItem: "Desconhecido A", valor: money("60") }),
          lv({ id: 2, servicoItem: "Desconhecido B", valor: money("40") }),
        ],
        [],
      );
      // UMA linha só (não duas): mesma categoria "Sem Categoria" para os dois itens.
      expect(resultado.linhas).toHaveLength(1);
      expect(resultado.linhas[0]!.chaveLinha).toBe("Sem Categoria");
      expect(resultado.linhas[0]!.servicoOuPlano).toBe("Desconhecido A; Desconhecido B");
      // Proporcionado "N": só existe UMA categoria distinta na fatura ("Sem Categoria"),
      // mesmo com dois serviços físicos diferentes por trás dela.
      expect(resultado.linhas[0]!.proporcionado).toBe("N");
      expect(resultado.linhas[0]!.valorRecebidoCategoria.toString()).toBe("100");
    });

    it("SEM_LV usa a categoria como chaveLinha (não mais o plano contratado)", () => {
      const resultado = categorizeInvoices([cr({ planoContratado: "Plano Y" })], [], []);
      expect(resultado.linhas[0]!.chaveLinha).toBe("Sem Categoria");
      expect(resultado.linhas[0]!.servicoOuPlano).toBe("Plano Y");
    });

    it("SEM_LV sem plano contratado usa 'Sem item' como servicoOuPlano (replica `fatura['plano'] or 'Sem item'`)", () => {
      const resultado = categorizeInvoices([cr({ planoContratado: "" })], [], []);
      expect(resultado.linhas[0]!.servicoOuPlano).toBe("Sem item");
    });
  });

  it("dois itens com o MESMO nome de serviço na mesma fatura: nomes concatenados sem dedup (porta exata de '; '.join(...), auditoria 2026-07-23)", () => {
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("100") })],
      [
        lv({ id: 1, servicoItem: "Sala de Reunião Avulsa - 2h", valor: money("50") }),
        lv({ id: 2, servicoItem: "Sala de Reunião Avulsa - 2h", valor: money("50") }),
      ],
      [{ nome: "Sala de Reunião Avulsa - 2h", categoria: "Salas Privativas" }],
    );
    expect(resultado.linhas).toHaveLength(1);
    expect(resultado.linhas[0]!.servicoOuPlano).toBe("Sala de Reunião Avulsa - 2h; Sala de Reunião Avulsa - 2h");
    expect(resultado.linhas[0]!.valorRecebidoCategoria.toString()).toBe("100");
  });

  it("mistura de categorias mapeada + não-mapeada -> Proporcionado S (2 categorias distintas)", () => {
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("100") })],
      [
        lv({ id: 1, servicoItem: "Sala A", valor: money("70") }),
        lv({ id: 2, servicoItem: "Desconhecido", valor: money("30") }),
      ],
      [{ nome: "Sala A", categoria: "Categoria A" }],
    );
    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.linhas.every((l) => l.proporcionado === "S")).toBe(true);
    const soma = resultado.linhas.reduce((acc, l) => acc.plus(l.valorRecebidoCategoria), money("0"));
    expect(soma.toString()).toBe("100");
  });
});

/**
 * Detalhe por item (ADR-0028). Duas invariantes que, se quebrarem, fazem a
 * divisão do push creditar receita à sala errada — silenciosamente.
 */
describe("categorizeInvoices — itens por linha", () => {
  it("guarda cada item com seu valor rateado, e a soma fecha com o valor da linha", () => {
    // Caso real (fatura 27320): 3 salas na mesma categoria, valores distintos.
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("123.75") })],
      [
        lv({ id: 10, servicoItem: "[SEAWAY] - SALA DE ATENDIMENTO 03", valor: money("48.75") }),
        lv({ id: 11, servicoItem: "[SEAWAY] - SALA DE ATENDIMENTO 02", valor: money("48.75") }),
        lv({ id: 12, servicoItem: "[SEAWAY] - Cabine", valor: money("26.25") }),
      ],
      [
        { nome: "[SEAWAY] - SALA DE ATENDIMENTO 03", categoria: "Serviços de Espaço" },
        { nome: "[SEAWAY] - SALA DE ATENDIMENTO 02", categoria: "Serviços de Espaço" },
        { nome: "[SEAWAY] - Cabine", categoria: "Serviços de Espaço" },
      ],
    );

    expect(resultado.linhas).toHaveLength(1);
    const linha = resultado.linhas[0]!;
    expect(linha.valorRecebidoCategoria.toString()).toBe("123.75");

    // O detalhe que antes se perdia: 3 itens, com o valor de cada um.
    expect(linha.itens).toHaveLength(3);
    expect(linha.itens!.map((i) => i.valorRateado)).toEqual(["48.75", "48.75", "26.25"]);
    expect(linha.itens!.map((i) => i.lvId)).toEqual([10, 11, 12]);

    // INVARIANTE: soma(itens) + ajuste = valor da linha.
    const somaItens = linha.itens!.reduce((acc, i) => acc.plus(money(i.valorRateado)), money("0"));
    expect(somaItens.plus(money(linha.ajusteArredondamento ?? "0")).toString()).toBe(
      linha.valorRecebidoCategoria.toString(),
    );
  });

  it("a invariante soma(itens)+ajuste = valor vale para TODAS as linhas, inclusive com rateio entre categorias", () => {
    // Rateio real: recebido (100) != soma bruta dos itens (120), 2 categorias.
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("100") })],
      [
        lv({ id: 1, servicoItem: "Sala A", valor: money("70") }),
        lv({ id: 2, servicoItem: "Serviço B", valor: money("50") }),
      ],
      [
        { nome: "Sala A", categoria: "Categoria A" },
        { nome: "Serviço B", categoria: "Categoria B" },
      ],
    );

    for (const linha of resultado.linhas) {
      const somaItens = linha.itens!.reduce((acc, i) => acc.plus(money(i.valorRateado)), money("0"));
      expect(somaItens.plus(money(linha.ajusteArredondamento ?? "0")).toString()).toBe(
        linha.valorRecebidoCategoria.toString(),
      );
    }
    // E o total da fatura continua fechando exato.
    const total = resultado.linhas.reduce((acc, l) => acc.plus(l.valorRecebidoCategoria), money("0"));
    expect(total.toString()).toBe("100");
  });

  it("itens repetidos na mesma fatura viram entradas SEPARADAS (nome nunca é chave)", () => {
    const resultado = categorizeInvoices(
      [cr({ valorRecebido: money("60") })],
      [
        lv({ id: 1, servicoItem: "Sala A", valor: money("30") }),
        lv({ id: 2, servicoItem: "Sala A", valor: money("30") }),
      ],
      [{ nome: "Sala A", categoria: "Categoria A" }],
    );
    const linha = resultado.linhas[0]!;
    expect(linha.itens).toHaveLength(2);
    expect(linha.itens!.map((i) => i.lvId)).toEqual([1, 2]);
  });

  it("fatura SEM LV casado não tem itens — quem consome precisa tratar a ausência", () => {
    const resultado = categorizeInvoices([cr({ valorRecebido: money("100") })], [], []);
    expect(resultado.linhas[0]!.proporcionado).toBe("SEM_LV");
    expect(resultado.linhas[0]!.itens).toBeUndefined();
  });
});
