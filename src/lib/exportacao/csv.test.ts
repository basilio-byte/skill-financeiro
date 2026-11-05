import { describe, expect, it } from "vitest";
import { BLANK, D, DT, FBRL, HX, INT, PCT, type Sheet } from "@/lib/xlsx/writer";
import { abaDeDetalhe, abaDeTabela } from "@/lib/exportacao/planilha";
import type { ColunaDef } from "@/lib/exportacao/tipos";
import { conferirCsv, csvDaAba, gerarCsvConferido, lerCsv, linhasDeDados, textoCsv } from "@/lib/exportacao/csv";
import { entregar } from "@/lib/exportacao/empacotar";
import { ExportacaoInconsistenteError } from "@/lib/exportacao/tipos";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface L {
  id: number;
  nome: string;
  valor: string;
  data: Date | null;
  quando: Date | null;
  obs: string | null;
}
const COLUNAS: ColunaDef<L>[] = [
  { id: "id", titulo: "ID", grupo: "essenciais", tipo: "id", largura: 8, valor: (l) => l.id, campos: ["id"] },
  { id: "nome", titulo: "Nome", grupo: "essenciais", tipo: "texto", largura: 20, valor: (l) => l.nome, campos: ["nome"] },
  { id: "valor", titulo: "Valor", grupo: "essenciais", tipo: "dinheiro", largura: 12, valor: (l) => l.valor, campos: ["valor"] },
  { id: "data", titulo: "Data", grupo: "essenciais", tipo: "data", largura: 12, valor: (l) => l.data, campos: ["data"] },
  { id: "quando", titulo: "Quando", grupo: "essenciais", tipo: "datahora", largura: 16, valor: (l) => l.quando, campos: ["quando"] },
  { id: "obs", titulo: "Observação", grupo: "essenciais", tipo: "texto", largura: 30, valor: (l) => l.obs, campos: ["obs"] },
];
const LINHAS: L[] = [
  { id: 1, nome: "Fulano de Tal", valor: "1234.50", data: dia("2026-10-01"), quando: new Date("2026-10-01T12:30:00Z"), obs: null },
  { id: 2, nome: "Beltrano & Cia; Filhos", valor: "-12.50", data: null, quando: null, obs: "texto com \"aspas\" e\nquebra de linha" },
  { id: 3, nome: "=HYPERLINK(\"http://x\")", valor: "0.10", data: dia("2026-12-31"), quando: null, obs: "+55 84 99999-0000" },
];

describe("proteção contra injeção de fórmula (textoCsv)", () => {
  it("texto que começa com = + - @ tab ou CR ganha apóstrofo; o resto não", () => {
    expect(textoCsv("=1+1")).toBe("'=1+1");
    expect(textoCsv("+55 84 99999-0000")).toBe("'+55 84 99999-0000");
    expect(textoCsv("-x")).toBe("'-x");
    expect(textoCsv("@usuario")).toBe("'@usuario");
    expect(textoCsv("\tabc")).toBe("'\tabc");
    expect(textoCsv("Endereço Fiscal")).toBe("Endereço Fiscal");
    expect(textoCsv("a=b")).toBe("a=b"); // só importa o PRIMEIRO caractere
  });

  it("aspas só quando precisa: separador, aspas e quebra de linha (aspas internas dobradas)", () => {
    expect(textoCsv("a;b")).toBe('"a;b"');
    expect(textoCsv('diz "oi"')).toBe('"diz ""oi"""');
    expect(textoCsv("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(textoCsv("simples")).toBe("simples");
  });
});

describe("csvDaAba", () => {
  const { aba } = abaDeDetalhe({ nome: "Detalhe", colunas: COLUNAS, linhas: LINHAS, colunaTotal: "valor" });

  it("UTF-8 com BOM, CRLF, separador ponto e vírgula, decimal com vírgula, datas dd/mm/aaaa", () => {
    const { texto, nLinhas } = csvDaAba(aba);
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    expect(texto.endsWith("\r\n")).toBe(true);
    expect(nLinhas).toBe(3);
    const linhas = lerCsv(texto);
    expect(linhas[0]).toEqual(["ID", "Nome", "Valor", "Data", "Quando", "Observação"]);
    expect(linhas[1]).toEqual(["1", "Fulano de Tal", "1234,50", "01/10/2026", "01/10/2026 12:30", ""]);
  });

  it("número negativo é número (sem apóstrofo); texto perigoso é protegido; campo com ; e quebra sobrevive à ida e volta", () => {
    const linhas = lerCsv(csvDaAba(aba).texto);
    expect(linhas[2]![2]).toBe("-12,50"); // dinheiro negativo NÃO é texto: sem apóstrofo
    expect(linhas[2]![1]).toBe("Beltrano & Cia; Filhos");
    expect(linhas[2]![5]).toBe('texto com "aspas" e\nquebra de linha');
    expect(linhas[3]![1]).toBe("'=HYPERLINK(\"http://x\")"); // fórmula neutralizada
    expect(linhas[3]![5]).toBe("'+55 84 99999-0000"); // telefone começando com +
    expect(linhas[3]![3]).toBe("31/12/2026");
  });

  it("o rodapé TOTAL, a linha em branco e as notas ficam de fora: só cabeçalho + dados", () => {
    const linhas = lerCsv(csvDaAba(aba).texto);
    expect(linhas).toHaveLength(4);
    expect(linhas.flat()).not.toContain("TOTAL");
  });

  it("abaDeTabela sem autofiltro: dados até a primeira linha em branco", () => {
    const tabela = abaDeTabela({
      nome: "Resumo",
      colunas: [{ titulo: "Chave", tipo: "texto", largura: 10 }, { titulo: "Qtd", tipo: "inteiro", largura: 6 }, { titulo: "%", tipo: "percentual", largura: 6 }],
      linhas: [["a", 2, "12.5"], ["b", 3, "87.5"]],
      total: ["TOTAL", 5, "100.00"],
      nota: "nota",
      autoFiltro: false,
    });
    expect(linhasDeDados(tabela)).toBe(2);
    expect(lerCsv(csvDaAba(tabela).texto)).toEqual([["Chave", "Qtd", "%"], ["a", "2", "12,5"], ["b", "3", "87,5"]]);
  });

  it("célula de fórmula sai com o valor em cache; vazia sai vazia", () => {
    const folha: Sheet = { name: "x", congelarLinhas: 1, rows: [[HX("A"), HX("B"), HX("C")], [FBRL("SUBTOTAL(109,A1:A2)", "3.50"), BLANK, D(null)]] };
    expect(lerCsv(csvDaAba({ ...folha, autoFiltro: { primeiraLinha: 1, ultimaLinha: 2, ultimaColuna: 2 } }).texto)[1]).toEqual(["3,50", "", ""]);
  });

  it("tipos de célula: inteiro, percentual, data e hora", () => {
    const folha: Sheet = {
      name: "x",
      autoFiltro: { primeiraLinha: 1, ultimaLinha: 2, ultimaColuna: 3 },
      rows: [[HX("I"), HX("P"), HX("D"), HX("H")], [INT("1234"), PCT("12.34"), D(dia("2026-02-28")), DT(new Date("2026-02-28T23:59:00Z"))]],
    };
    expect(lerCsv(csvDaAba(folha).texto)[1]).toEqual(["1234", "12,34", "28/02/2026", "28/02/2026 23:59"]);
  });
});

describe("lerCsv", () => {
  it("lê aspas, separador e quebra dentro de campo, com ou sem BOM, CRLF ou LF", () => {
    expect(lerCsv('a;"b;c";d\r\n"x ""y""";2;3\r\n')).toEqual([["a", "b;c", "d"], ['x "y"', "2", "3"]]);
    expect(lerCsv("﻿a;b\nc;d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(lerCsv('"l1\r\nl2";z')).toEqual([["l1\r\nl2", "z"]]);
  });
});

describe("conferirCsv (prova que a conferência ACUSA defeito)", () => {
  const { aba } = abaDeDetalhe({ nome: "Detalhe", colunas: COLUNAS, linhas: LINHAS, colunaTotal: "valor" });
  const { texto } = csvDaAba(aba);
  const esperado = { nomeAba: "Detalhe", titulos: COLUNAS.map((c) => c.titulo), nLinhas: 3, indiceValor: 2, total: "1222.10" };

  it("CSV íntegro: nenhuma divergência", () => {
    expect(conferirCsv(texto, esperado)).toEqual([]);
  });

  it("acusa soma diferente, linha a menos, cabeçalho trocado, número que virou texto e linha torta", () => {
    expect(conferirCsv(texto, { ...esperado, total: "1222.11" }).some((p) => p.includes("soma lida do CSV"))).toBe(true);
    expect(conferirCsv(texto, { ...esperado, nLinhas: 4 }).some((p) => p.includes("linha(s) de dados"))).toBe(true);
    expect(conferirCsv(texto, { ...esperado, titulos: ["X", ...esperado.titulos.slice(1)] }).some((p) => p.includes("cabeçalho da coluna 1"))).toBe(true);
    expect(conferirCsv(texto.replace("1234,50", "R$ 1.234,50"), esperado).some((p) => p.includes("não é número"))).toBe(true);
    expect(conferirCsv(texto + "so;dois\r\n", esperado).some((p) => p.includes("campos, o cabeçalho tem"))).toBe(true);
  });

  it("gerarCsvConferido entrega o buffer e recusa o que não fecha", () => {
    const ok = gerarCsvConferido(aba, esperado);
    expect(ok.contentType).toContain("text/csv");
    expect(ok.buffer.length).toBeGreaterThan(20);
    expect(() => gerarCsvConferido(aba, { ...esperado, total: "1.00" })).toThrow(ExportacaoInconsistenteError);
  });
});

describe("entregar (ponto único de saída)", () => {
  const { aba, total, indiceColunaTotal } = abaDeDetalhe({ nome: "Detalhe", colunas: COLUNAS, linhas: LINHAS, colunaTotal: "valor" });
  const esperado = [{ nomeAba: "Detalhe", titulos: COLUNAS.map((c) => c.titulo), nLinhas: 3, indiceValor: indiceColunaTotal, total: total! }];

  it("xlsx: planilha comprimida e conferida; csv: só a aba principal", () => {
    const x = entregar([aba], esperado, "xlsx", "Detalhe");
    expect(x.extensao).toBe("xlsx");
    expect(x.contentType).toContain("spreadsheetml");
    const c = entregar([{ name: "Leia-me", rows: [[HX("x")]] }, aba], esperado, "csv", "Detalhe");
    expect(c.extensao).toBe("csv");
    expect(c.contentType).toContain("text/csv");
    expect(lerCsv(c.buffer.toString("utf8"))).toHaveLength(4);
  });

  it("csv sem a aba principal é erro explícito", () => {
    expect(() => entregar([aba], esperado, "csv", "Inexistente")).toThrow(/aba principal/);
  });
});
