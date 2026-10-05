import { describe, expect, it } from "vitest";
import { buildXlsx, H, T } from "@/lib/xlsx/writer";
import {
  COLUNAS_CONTAS_RECEBER,
  COLUNAS_LISTAR_VENDAS,
  ImportacaoInvalidaError,
  validarArquivos,
} from "@/lib/categorization/validar-exports";

const xlsx = (cabecalho: readonly string[], linhas: string[][]) =>
  buildXlsx([{ name: "Planilha1", rows: [cabecalho.map((c) => H(c)), ...linhas.map((l) => l.map((c) => T(c)))] }]);

const linhaCR = (dataCredito: string) => COLUNAS_CONTAS_RECEBER.map((c) => (c === "Data Crédito" ? dataCredito : "x"));
const linhaLV = () => COLUNAS_LISTAR_VENDAS.map(() => "x");

const crOk = () => xlsx(COLUNAS_CONTAS_RECEBER, [linhaCR("10/09/2026")]);
const lvOk = () => xlsx(COLUNAS_LISTAR_VENDAS, [linhaLV()]);

function mensagem(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImportacaoInvalidaError);
    return (err as Error).message;
  }
  throw new Error("esperava ImportacaoInvalidaError");
}

describe("validarArquivos", () => {
  it("aceita o par correto e conta as linhas", () => {
    const r = validarArquivos(crOk(), lvOk());
    expect(r).toEqual({ linhasContasReceber: 1, linhasListarVendas: 1 });
  });

  it("aceita Data Crédito como lista de datas (faturas recorrentes)", () => {
    const cr = xlsx(COLUNAS_CONTAS_RECEBER, [linhaCR("10/08/2026, 10/09/2026")]);
    expect(validarArquivos(cr, lvOk()).linhasContasReceber).toBe(1);
  });

  it("recusa o que não é .xlsx, dizendo para enviar o arquivo como baixado", () => {
    const msg = mensagem(() => validarArquivos(Buffer.from("ID;Status\n1;Quitada"), lvOk()));
    expect(msg).toMatch(/não é um arquivo \.xlsx/);
  });

  it("detecta os dois arquivos TROCADOS e diz para inverter", () => {
    const msg = mensagem(() => validarArquivos(lvOk(), crOk()));
    expect(msg).toMatch(/trocados/);
  });

  it("nomeia as colunas que faltam (export de outra tela)", () => {
    const cr = xlsx(["ID", "Status"], [["1", "Quitada"]]);
    const msg = mensagem(() => validarArquivos(cr, lvOk()));
    expect(msg).toMatch(/Contas a Receber/);
    expect(msg).toMatch(/"Data Crédito"/);
  });

  it("recusa arquivo só com cabeçalho (filtro do Conexa sem resultado)", () => {
    const cr = xlsx(COLUNAS_CONTAS_RECEBER, []);
    expect(mensagem(() => validarArquivos(cr, lvOk()))).toMatch(/nenhuma linha/);
    const lv = xlsx(COLUNAS_LISTAR_VENDAS, []);
    expect(mensagem(() => validarArquivos(crOk(), lv))).toMatch(/Listar Vendas não tem nenhuma linha/);
  });

  it("recusa Data Crédito ilegível (arquivo reescrito pelo Excel vira número serial)", () => {
    const cr = xlsx(COLUNAS_CONTAS_RECEBER, [linhaCR("46275"), linhaCR("46276")]);
    expect(mensagem(() => validarArquivos(cr, lvOk()))).toMatch(/Data Crédito.*ilegível/);
  });

  it("tolera algumas linhas sem Data Crédito desde que alguma seja legível", () => {
    const cr = xlsx(COLUNAS_CONTAS_RECEBER, [linhaCR(""), linhaCR("10/09/2026")]);
    expect(validarArquivos(cr, lvOk()).linhasContasReceber).toBe(2);
  });
});
