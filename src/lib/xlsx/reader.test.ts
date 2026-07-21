import { describe, expect, it } from "vitest";
import { buildXlsx, H, T, N } from "@/lib/xlsx/writer";
import { readXlsxRows, readXlsxAsObjects, parseMoneyCell } from "@/lib/xlsx/reader";

describe("xlsx reader", () => {
  it("lê de volta um xlsx gerado pelo próprio writer (round-trip)", () => {
    const buffer = buildXlsx([
      {
        name: "Teste",
        rows: [
          [H("Nome"), H("Valor")],
          [T("Fulano de Tal"), N("1234.56")],
          [T("Beltrano & Cia"), N("10")],
        ],
      },
    ]);

    const rows = readXlsxRows(buffer);
    expect(rows).toEqual([
      ["Nome", "Valor"],
      ["Fulano de Tal", "1234.56"],
      ["Beltrano & Cia", "10"],
    ]);
  });

  it("lê como objetos usando a primeira linha como cabeçalho", () => {
    const buffer = buildXlsx([
      {
        name: "Teste",
        rows: [
          [H("Nome"), H("Valor")],
          [T("Fulano"), N("1234.56")],
        ],
      },
    ]);

    const objects = readXlsxAsObjects(buffer);
    expect(objects).toEqual([{ Nome: "Fulano", Valor: "1234.56" }]);
  });
});

describe("parseMoneyCell", () => {
  it("interpreta número solto (sem vírgula) como decimal direto", () => {
    expect(parseMoneyCell("87.5").toString()).toBe("87.5");
  });

  it("interpreta formato BR (com vírgula) removendo separador de milhar", () => {
    expect(parseMoneyCell("1.328,62").toString()).toBe("1328.62");
  });

  it("trata vazio/nulo como zero", () => {
    expect(parseMoneyCell("").toString()).toBe("0");
    expect(parseMoneyCell(null).toString()).toBe("0");
  });
});
