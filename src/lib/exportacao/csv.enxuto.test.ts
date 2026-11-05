import { describe, expect, it } from "vitest";
import { BRL, H, HX, N, T, type Sheet } from "@/lib/xlsx/writer";
import { conferirCsv, csvDaAba, lerCsv, varrerCsv } from "./csv";

/** O que a varredura enxuta devolve, no formato da leitura completa, para comparar as duas. */
function viaVarredura(texto: string, indiceValor: number) {
  const cabecalho: string[] = [];
  const registros: Array<{ linha: number; campos: number; valor: string | undefined }> = [];
  varrerCsv(texto, indiceValor, cabecalho, (linha, campos, valor) => registros.push({ linha, campos, valor }));
  return { cabecalho, registros };
}

describe("cabeçalho do CSV sempre entre aspas (Excel trata CSV que começa por 'ID' como SYLK)", () => {
  const aba: Sheet = {
    name: "x",
    rows: [[HX("ID Fatura"), HX("Valor; total"), HX('Ele disse "oi"'), HX("=cmd")], [N("29113"), BRL("10.50"), T("a"), T("b")]],
    autoFiltro: { primeiraLinha: 1, ultimaLinha: 2, ultimaColuna: 3 },
  };

  it("o arquivo NÃO começa por ID (depois do BOM vem uma aspa) e os campos de dados seguem sem aspas desnecessárias", () => {
    const { texto } = csvDaAba(aba);
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    expect(texto.slice(1, 12)).toBe('"ID Fatura"');
    expect(texto.slice(1)).not.toMatch(/^ID/);
    const linhas = texto.slice(1).split("\r\n");
    expect(linhas[0]).toBe('"ID Fatura";"Valor; total";"Ele disse ""oi""";"\'=cmd"'); // aspas dobradas e apóstrofo contra fórmula
    expect(linhas[1]).toBe("29113;10,50;a;b");
  });

  it("lê de volta idêntico ao cabeçalho original (o conferidor continua fechando)", () => {
    const { texto } = csvDaAba(aba);
    expect(lerCsv(texto)[0]).toEqual(["ID Fatura", "Valor; total", 'Ele disse "oi"', "'=cmd"]);
    expect(conferirCsv(texto, { nomeAba: "x", titulos: ["ID Fatura", "Valor; total", 'Ele disse "oi"', "'=cmd"], nLinhas: 1, indiceValor: 1, total: "10.50" })).toEqual([]);
  });
});

describe("varrerCsv (conferência sem guardar os campos) = lerCsv", () => {
  const CASOS: Array<[string, string]> = [
    ["simples CRLF", "﻿a;b;c\r\n1;2;3\r\n4;5;6\r\n"],
    ["simples LF", "a;b;c\n1;2;3\n4;5;6\n"],
    ["sem quebra no fim", "a;b\r\n1;2"],
    ["campos vazios", "a;b;c\r\n;;\r\n1;;3\r\n"],
    ["aspas, separador e aspas dobradas dentro do campo", 'a;b\r\n"x;y";"ele disse ""oi"""\r\n"";z\r\n'],
    ["quebra de linha dentro do campo (CRLF e LF)", 'a;b\r\n"linha 1\r\nlinha 2";2\r\n"l1\nl2";3\r\n'],
    ["linha curta e linha longa", "a;b;c\r\n1;2\r\n1;2;3;4\r\n"],
    ["linha em branco no meio", "a;b\r\n1;2\r\n\r\n3;4\r\n"],
    ["só o cabeçalho", "a;b;c\r\n"],
    ["vazio", ""],
    ["aspa no meio de campo sem aspas", 'a;b\r\nab"cd;e\r\n'],
    ["acentos e emoji", "ação;valor\r\nmaçã 🍎;1,50\r\n"],
  ];

  for (const [nome, texto] of CASOS) {
    it(`mesmo cabeçalho, mesma contagem e mesmo valor por coluna: ${nome}`, () => {
      const completa = lerCsv(texto);
      for (const indice of [0, 1, 2, 5, -1]) {
        const v = viaVarredura(texto, indice);
        expect(v.cabecalho, `cabeçalho (coluna ${indice})`).toEqual(completa[0] ?? []);
        expect(v.registros.length, `registros (coluna ${indice})`).toBe(Math.max(0, completa.length - 1));
        v.registros.forEach((r, k) => {
          const linha = completa[k + 1]!;
          expect(r.linha).toBe(k + 2);
          expect(r.campos, `campos da linha ${r.linha}`).toBe(linha.length);
          expect(r.valor, `valor da linha ${r.linha} (coluna ${indice})`).toBe(indice >= 0 ? linha[indice] : undefined);
        });
      }
    });
  }

  it("com texto grande, acha o mesmo que a leitura completa (20 mil linhas de 600 caracteres + campos com aspas)", () => {
    const linhas = ['"ID";"Valor";"Obs"'];
    let soma = 0;
    for (let i = 0; i < 2000; i++) {
      soma += i * 0.25;
      linhas.push(`${i};${(i * 0.25).toFixed(2).replace(".", ",")};"${"texto; com \"\"aspas\"\" e\nquebra ".repeat(20)}"`);
    }
    const texto = "﻿" + linhas.join("\r\n") + "\r\n";
    expect(conferirCsv(texto, { nomeAba: "x", titulos: ["ID", "Valor", "Obs"], nLinhas: 2000, indiceValor: 1, total: soma.toFixed(2) })).toEqual([]);
    // 1 centavo a mais na soma esperada é acusado
    expect(conferirCsv(texto, { nomeAba: "x", titulos: ["ID", "Valor", "Obs"], nLinhas: 2000, indiceValor: 1, total: (soma + 0.01).toFixed(2) })[0]).toMatch(/soma lida do CSV/);
  });

  it("acusa linha com número de campos diferente, valor que não é número e contagem errada", () => {
    const texto = "﻿a;v\r\n1;10,00\r\n2;abc\r\n3\r\n";
    const problemas = conferirCsv(texto, { nomeAba: "x", titulos: ["a", "v"], nLinhas: 2, indiceValor: 1, total: "10.00" });
    expect(problemas.join(" | ")).toMatch(/linha 3: valor "abc" não é número/);
    expect(problemas.join(" | ")).toMatch(/linha 4: 1 campos, o cabeçalho tem 2/);
    expect(problemas.join(" | ")).toMatch(/o CSV tem 3 linha\(s\) de dados, esperado 2/);
  });
});
