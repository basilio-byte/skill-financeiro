import { describe, expect, it } from "vitest";
import { filtroPorPadroes, normalizarPadroes, PadroesVazioError } from "@/lib/clickup/filtro-padroes";

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

describe("filtroPorPadroes", () => {
  it("monta categoria + OR de contains case-insensitive por padrão", () => {
    const filtro = filtroPorPadroes("Endereço Fiscal", ["Batial"]);
    expect(filtro).toEqual({
      categoria: "Endereço Fiscal",
      OR: [{ servicoOuPlano: { contains: "Batial", mode: "insensitive" } }],
    });
  });

  it("um padrão por entrada do OR, na mesma ordem", () => {
    const filtro = filtroPorPadroes("Endereço Fiscal", ["Batial", "EV Batial"]);
    expect(filtro.OR).toHaveLength(2);
  });

  it("lança PadroesVazioError se a lista de padrões estiver vazia", () => {
    expect(() => filtroPorPadroes("Endereço Fiscal", [])).toThrow(PadroesVazioError);
  });
});
