import { describe, expect, it } from "vitest";
import { bateAlgumPadrao, normalizarPadroes, PadroesVazioError } from "@/lib/clickup/filtro-padroes";

describe("normalizarPadroes", () => {
  it("separa por linha, tira espaço e descarta vazios", () => {
    expect(normalizarPadroes("Batial\n  Litoral  \n\nAbissal\n")).toEqual(["Batial", "Litoral", "Abissal"]);
  });

  it("também aceita separado por vírgula", () => {
    expect(normalizarPadroes("Batial, Litoral,Abissal")).toEqual(["Batial", "Litoral", "Abissal"]);
  });

  it("remove duplicatas", () => {
    expect(normalizarPadroes("Batial\nBatial\nLitoral")).toEqual(["Batial", "Litoral"]);
  });

  it("string vazia vira lista vazia", () => {
    expect(normalizarPadroes("")).toEqual([]);
  });
});

describe("bateAlgumPadrao", () => {
  it("casa um padrão que aparece como substring da linha", () => {
    expect(bateAlgumPadrao("Seatech - EV - Endereço Fiscal Batial Mensal (SEATECH)", ["Batial"])).toBe(true);
  });

  it("ignora acento dos dois lados — caso real: 'Comércio' (padrão) casa com 'Comercio' (linha) e vice-versa", () => {
    expect(bateAlgumPadrao("Endereço Fiscal De Comercio Mensal (SEATECH)", ["Comércio"])).toBe(true);
    expect(bateAlgumPadrao("Endereço Fiscal de Comércio Mensal (SEAHUB COWORKING)", ["Comercio"])).toBe(true);
  });

  it("ignora maiúscula/minúscula", () => {
    expect(bateAlgumPadrao("ENDEREÇO FISCAL BATIAL", ["batial"])).toBe(true);
  });

  it("não casa quando nenhum padrão aparece na linha", () => {
    expect(bateAlgumPadrao("Endereço Fiscal Litoral Mensal", ["Batial", "Abissal"])).toBe(false);
  });

  it("OR entre padrões — basta um bater", () => {
    expect(bateAlgumPadrao("Endereço Fiscal Litoral Mensal", ["Batial", "Litoral"])).toBe(true);
  });

  it("lança PadroesVazioError se a lista de padrões estiver vazia", () => {
    expect(() => bateAlgumPadrao("qualquer coisa", [])).toThrow(PadroesVazioError);
  });
});
