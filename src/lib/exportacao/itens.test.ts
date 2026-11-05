import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx/writer";
import { lerAba } from "@/lib/xlsx/inspecionar";
import { money, sum, toAmountString } from "@/lib/money";
import type { LinhaReceita } from "@/lib/exportacao/colunas-receita";
import { MAX_LINHAS_ITENS, abaDeItens, lerItens } from "@/lib/exportacao/itens";
import { lerFiltrosReceita } from "@/lib/exportacao/filtros-receita";
import { montarAbasReceita } from "@/lib/exportacao/pasta-receita";
import { ExportacaoGrandeDemaisError, ExportacaoInconsistenteError } from "@/lib/exportacao/tipos";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let seq = 0;
function linha(p: Partial<LinhaReceita>): LinhaReceita {
  seq += 1;
  return {
    id: `id${seq}`, crConexaId: seq, chaveLinha: `k${seq}`, unidade: "U", faturamento: "F", clienteConexaId: 1, cpfCnpj: null,
    razaoSocial: "Cliente", planoContratado: "P", categoria: "Salas Privativas - Seaway Center", servicoOuPlano: "Sala A; Sala B; Sala C",
    proporcionado: "S", tipo: "T", status: "Quitada", parcela: "1/1", valorRecebidoCat: "123.75", valorRecebidoTotal: "300.00",
    valorBruto: "300.00", valorDesconto: "0.00", vencimento: null, quitacao: null, competencia: null, emissao: null,
    dataCredito: dia("2026-10-15"), mesCredito: "2026-10", conta: "C", observacoes: null, tags: null, ajusteArredondamento: "0.01",
    revisadoManualmente: false, revisadoPorNome: null, revisadoEm: null, categoriaOriginal: null, valorRecebidoCatOriginal: null,
    atualizadoEm: dia("2026-11-01"),
    itensDetalhe: [
      { lvId: 1, servicoItem: "Sala A", categoriaConexa: "Salas", valorBruto: "100.00", valorRateado: "41.25" },
      { lvId: 2, servicoItem: "Sala B", categoriaConexa: "Salas", valorBruto: "100.00", valorRateado: "41.25" },
      { lvId: 3, servicoItem: "Sala C", categoriaConexa: "Salas", valorBruto: "100.00", valorRateado: "41.24" },
    ],
    ...p,
  };
}
// 41.25 + 41.25 + 41.24 = 123.74 ; + ajuste 0.01 = 123.75 ✓ (a invariante do motor)

describe("lerItens", () => {
  it("aceita só lista não vazia de itens bem formados; qualquer outra coisa é null (nunca confia no JSON do banco)", () => {
    expect(lerItens(null)).toBeNull();
    expect(lerItens([])).toBeNull();
    expect(lerItens("x")).toBeNull();
    expect(lerItens([{ servicoItem: "A" }])).toBeNull(); // sem valorRateado
    expect(lerItens([{ servicoItem: "A", valorRateado: "1,50" }])).toBeNull(); // vírgula: não é decimal
    expect(lerItens([{ servicoItem: "A", valorRateado: "1.50" }, null])).toBeNull();
    expect(lerItens([{ servicoItem: "A", valorRateado: "1.50" }])).toEqual([{ lvId: 0, servicoItem: "A", categoriaConexa: "", valorBruto: "", valorRateado: "1.50" }]);
  });
});

describe("abaDeItens", () => {
  it("uma linha com 3 itens e ajuste vira 4 linhas, e elas somam o valor da linha (a invariante do motor)", () => {
    const r = abaDeItens([linha({})]);
    expect(r.linhasDeItem).toBe(4);
    expect(toAmountString(r.soma)).toBe("123.75");
    const linhas = lerAba(buildXlsx([r.aba]), "Itens").linhas;
    expect(linhas.slice(1, 5).map((x) => x[7])).toEqual(["Sala A", "Sala B", "Sala C", "(ajuste de arredondamento)"]);
    expect(linhas.slice(1, 5).map((x) => x[10])).toEqual(["41.25", "41.25", "41.24", "0.01"]);
    expect(linhas.find((x) => x[0] === "TOTAL")![10]).toBe("123.75");
  });

  it("linha revisada à mão NÃO usa os itens: uma linha só, com o valor revisado", () => {
    const r = abaDeItens([linha({ revisadoManualmente: true, valorRecebidoCat: "99.99" })]);
    expect(r.revisadas).toBe(1);
    expect(r.linhasDeItem).toBe(1);
    expect(toAmountString(r.soma)).toBe("99.99");
    expect(lerAba(buildXlsx([r.aba]), "Itens").linhas[1]![7]).toBe("(linha revisada manualmente)");
  });

  it("linha sem itens (SEM_LV ou antiga) vira UMA linha marcada, nunca some", () => {
    const r = abaDeItens([linha({ itensDetalhe: null, proporcionado: "SEM_LV", valorRecebidoCat: "50.00" }), linha({ itensDetalhe: [], valorRecebidoCat: "10.00" })]);
    expect(r.semItens).toBe(2);
    expect(toAmountString(r.soma)).toBe("60.00");
    const l = lerAba(buildXlsx([r.aba]), "Itens").linhas;
    expect(l[1]![7]).toBe("(sem detalhe de itens)");
    expect(l[1]![11]).toContain("Sem item no Listar Vendas");
    expect(l[2]![11]).toContain("gravada sem detalhe por item");
  });

  it("itens que NÃO fecham com o valor da linha: UMA linha marcada com a causa, contada no aviso — e não 'consertada'", () => {
    const r = abaDeItens([linha({ valorRecebidoCat: "200.00" })]); // itens somam 123.74 + 0.01 ≠ 200
    expect(r.naoFecham).toBe(1);
    expect(r.linhasDeItem).toBe(1);
    expect(toAmountString(r.soma)).toBe("200.00"); // o total continua sendo o da linha
    const l = lerAba(buildXlsx([r.aba]), "Itens").linhas;
    expect(l[1]![7]).toBe("(itens não fecham com o valor da linha)");
    expect(l[1]![11]).toContain("123.74");
    expect(r.aviso).toContain("NÃO fecham");
  });

  it("misturando tudo, a soma de 'Valor Rateado' é exatamente a soma das linhas (centavo a centavo)", () => {
    const todas = [
      linha({}),
      linha({ revisadoManualmente: true, valorRecebidoCat: "99.99" }),
      linha({ itensDetalhe: null, valorRecebidoCat: "50.01" }),
      linha({ valorRecebidoCat: "200.00" }),
      linha({ itensDetalhe: [{ lvId: 9, servicoItem: "Único", categoriaConexa: "X", valorBruto: "10.10", valorRateado: "10.10" }], ajusteArredondamento: null, valorRecebidoCat: "10.10" }),
    ];
    const r = abaDeItens(todas);
    expect(toAmountString(r.soma)).toBe(toAmountString(sum(todas.map((l) => l.valorRecebidoCat))));
    expect(r.comItens).toBe(2);
    expect(r.aviso).toContain("5 linha(s) da receita");
  });

  it("recusa a aba que passaria do teto de linhas (com o que fazer)", () => {
    const muitas = Array.from({ length: MAX_LINHAS_ITENS + 1 }, () => linha({ itensDetalhe: null }));
    expect(() => abaDeItens(muitas)).toThrow(ExportacaoGrandeDemaisError);
  });
});

describe("a aba Itens dentro da pasta de receita", () => {
  const filtros = lerFiltrosReceita({ f: "1", grupos: "fatura", resumos: "1", itens: "1", mes: "2026-10" }).filtros;
  const linhas = [linha({}), linha({ itensDetalhe: null, valorRecebidoCat: "50.00" })];
  const entrada = (extras: Parameters<typeof montarAbasReceita>[0]["extras"]) => ({
    linhas,
    filtros,
    geradoEm: new Date("2026-11-04T20:00:00Z"),
    usuario: { id: "u", nome: "N", email: "n@t", papel: "ADMIN" as const },
    frescor: { texto: "ok", alerta: false },
    semDataCreditoNoBanco: 0,
    hoje: "2026-11-04",
    extras,
  });

  it("entra como última aba, e o resumo vai para os avisos do Leia-me", () => {
    const r = abaDeItens(linhas);
    const pasta = montarAbasReceita(entrada([{ aba: r.aba, soma: r.soma, aviso: r.aviso }]));
    expect(pasta.abas.at(-1)!.name).toBe("Itens");
    expect(lerAba(buildXlsx(pasta.abas), "Leia-me").linhas.flat().join(" ")).toContain("Aba Itens:");
  });

  it("se a soma da aba Itens não fecha com o detalhe, a montagem ABORTA (conferência interna)", () => {
    const r = abaDeItens(linhas);
    expect(() => montarAbasReceita(entrada([{ aba: r.aba, soma: money("1.00") }]))).toThrow(ExportacaoInconsistenteError);
  });
});
