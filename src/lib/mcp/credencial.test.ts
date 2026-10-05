import { describe, expect, it } from "vitest";
import { extrairToken, pedeFluxoSse } from "@/lib/mcp/credencial";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
const TOK = "shf_" + "A".repeat(43);

describe("extrairToken — flexível, mas o token é o que autentica", () => {
  it("Authorization: Bearer (Claude Code)", () => {
    expect(extrairToken(h({ authorization: `Bearer ${TOK}` }))).toBe(TOK);
    expect(extrairToken(h({ authorization: `bearer   ${TOK}` }))).toBe(TOK);
  });

  // O formulário da claude.ai NÃO deixa escolher "authorization": só estes nomes.
  it.each(["x-api-key", "api-key", "apikey", "x-apikey", "x-api-token", "api-token", "x-auth-token", "x-mcp-token"])(
    "aceita o token cru em %s",
    (nome) => {
      expect(extrairToken(h({ [nome]: TOK }))).toBe(TOK);
    },
  );

  it("aceita 'Bearer ' mesmo num cabeçalho de chave, e aspas coladas junto", () => {
    expect(extrairToken(h({ "x-api-key": `Bearer ${TOK}` }))).toBe(TOK);
    expect(extrairToken(h({ "x-api-key": `"${TOK}"` }))).toBe(TOK);
    expect(extrairToken(h({ "x-api-key": `  ${TOK}  ` }))).toBe(TOK);
  });

  it("sem nenhum cabeçalho: string vazia (e a rota responde 401/503, nunca autentica)", () => {
    expect(extrairToken(h({}))).toBe("");
    expect(extrairToken(h({ authorization: "   " }))).toBe("");
    expect(extrairToken(h({ "user-agent": "x" }))).toBe("");
  });

  it("authorization vence quando há dois; e um vazio não esconde o seguinte", () => {
    expect(extrairToken(h({ authorization: `Bearer ${TOK}`, "x-api-key": "outro" }))).toBe(TOK);
    expect(extrairToken(h({ authorization: "", "x-api-key": TOK }))).toBe(TOK);
  });

  it("não inventa token: devolve o que veio, e quem valida é o prefixo", () => {
    expect(extrairToken(h({ "x-api-key": "qualquer-coisa" }))).toBe("qualquer-coisa");
  });
});

describe("pedeFluxoSse", () => {
  it("só event-stream => quer SSE (a rota responde 405)", () => {
    expect(pedeFluxoSse("text/event-stream")).toBe(true);
  });

  it("aceita JSON, HTML ou qualquer coisa => é o cartão de visita, não SSE", () => {
    expect(pedeFluxoSse("application/json, text/event-stream")).toBe(false);
    expect(pedeFluxoSse("text/html,application/xhtml+xml")).toBe(false);
    expect(pedeFluxoSse("*/*")).toBe(false);
    expect(pedeFluxoSse(null)).toBe(false);
  });
});
