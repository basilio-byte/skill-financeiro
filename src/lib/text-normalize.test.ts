import { describe, expect, it } from "vitest";
import { normalizarTexto } from "@/lib/text-normalize";

describe("normalizarTexto", () => {
  it("remove acentos", () => {
    expect(normalizarTexto("Comércio")).toBe("comercio");
    expect(normalizarTexto("Comercio")).toBe("comercio");
  });

  it("ignora caixa", () => {
    expect(normalizarTexto("BATIAL")).toBe(normalizarTexto("batial"));
  });

  it("tira espaço nas pontas", () => {
    expect(normalizarTexto("  Março  ")).toBe("marco");
  });

  it("mantém espaços internos", () => {
    expect(normalizarTexto("Endereço Fiscal")).toBe("endereco fiscal");
  });
});
