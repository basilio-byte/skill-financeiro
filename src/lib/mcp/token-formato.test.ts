import { describe, expect, it } from "vitest";
import { gerarToken, hashDoToken, pareceTokenPessoal, prefixoVisivel, PREFIXO_TOKEN } from "./token-formato";

describe("formato do token pessoal do MCP", () => {
  it("tem prefixo reconhecível e 32 bytes de entropia", () => {
    const t = gerarToken();
    expect(t.startsWith(PREFIXO_TOKEN)).toBe(true);
    expect(pareceTokenPessoal(t)).toBe(true);
  });

  it("dois tokens nunca são iguais", () => {
    const vistos = new Set(Array.from({ length: 200 }, gerarToken));
    expect(vistos.size).toBe(200);
  });

  it("o hash é determinístico — é por ele que a autenticação procura", () => {
    const t = gerarToken();
    expect(hashDoToken(t)).toBe(hashDoToken(t));
    expect(hashDoToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("⚠ o hash não contém o token", () => {
    const t = gerarToken();
    expect(hashDoToken(t).includes(t.slice(4, 14))).toBe(false);
  });

  it("o prefixo visível identifica sem permitir usar", () => {
    const t = gerarToken();
    expect(prefixoVisivel(t).length).toBeLessThan(t.length / 3);
    expect(t.startsWith(prefixoVisivel(t))).toBe(true);
  });

  it("o token master do ambiente não passa por token pessoal", () => {
    expect(pareceTokenPessoal("mcp-local-dev-token-0123456789")).toBe(false);
    expect(pareceTokenPessoal("shf_curto")).toBe(false);
  });
});
