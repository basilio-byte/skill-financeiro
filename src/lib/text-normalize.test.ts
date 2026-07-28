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

  it("mantém espaços internos simples", () => {
    expect(normalizarTexto("Endereço Fiscal")).toBe("endereco fiscal");
  });

  it("colapsa espaço interno repetido — mesma sala escrita com 1, 2 ou 3 espaços (achado real na Conexa)", () => {
    const umEspaco = normalizarTexto("Sala 08 - Loja 24");
    expect(normalizarTexto("Sala 08  - Loja 24")).toBe(umEspaco);
    expect(normalizarTexto("Sala 08   - Loja 24")).toBe(umEspaco);
  });
});
