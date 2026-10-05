import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paraJsonSchema } from "./esquema";

/**
 * ⚠ Estes testes existem porque um esquema errado num MCP **não dá erro de
 * compilação**. Ele sobe, o cliente de IA lê "aceito qualquer coisa", e a
 * chamada malformada aparece semanas depois na frente de um usuário. O
 * compilador não cobre a fronteira entre zod e JSON Schema; só teste cobre.
 */
describe("paraJsonSchema", () => {
  it("converte os primitivos com as restrições", () => {
    expect(paraJsonSchema(z.string().min(2).max(9))).toEqual({
      type: "string",
      minLength: 2,
      maxLength: 9,
    });
    expect(paraJsonSchema(z.number().int().min(0).max(10))).toEqual({
      type: "integer",
      minimum: 0,
      maximum: 10,
    });
    expect(paraJsonSchema(z.boolean())).toEqual({ type: "boolean" });
  });

  it("leva a descrição adiante — é o que o modelo lê", () => {
    expect(paraJsonSchema(z.string().describe("o nome do cliente"))).toEqual({
      description: "o nome do cliente",
      type: "string",
    });
  });

  it("converte enum e regex", () => {
    expect(paraJsonSchema(z.enum(["a", "b"]))).toEqual({ type: "string", enum: ["a", "b"] });
    expect(paraJsonSchema(z.string().regex(/^\d{4}-\d{2}$/))).toEqual({
      type: "string",
      pattern: "^\\d{4}-\\d{2}$",
    });
  });

  it("marca como obrigatório só o que não é opcional nem tem default", () => {
    const j = paraJsonSchema(
      z.object({
        obrigatorio: z.string(),
        opcional: z.string().optional(),
        comDefault: z.number().default(5),
      }),
    );
    expect(j.required).toEqual(["obrigatorio"]);
    expect(j.properties?.comDefault).toEqual({ type: "number", default: 5 });
    // ⚠ Fechado: um campo inventado precisa dar erro, não ser ignorado.
    expect(j.additionalProperties).toBe(false);
  });

  it("aninha objeto e array", () => {
    const j = paraJsonSchema(
      z.object({ itens: z.array(z.object({ id: z.number().int() })) }),
    );
    expect(j.properties?.itens).toEqual({
      type: "array",
      items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    });
  });

  it("nullable vira união com null, sem perder o tipo", () => {
    expect(paraJsonSchema(z.string().nullable())).toEqual({ type: ["string", "null"] });
  });

  it("lança no tipo que não cobre, em vez de devolver {}", () => {
    // ⚠ O contrário — devolver `{}` por omissão — faria a ferramenta anunciar
    // "qualquer coisa serve", e é assim que um MCP aceita lixo em silêncio.
    expect(() => paraJsonSchema(z.date())).toThrow(/não cobre/i);
  });
});

describe("literal com tipo (confirmarExclusao)", () => {
  it("z.literal(true) publica type boolean junto de const", () => {
    const j = paraJsonSchema(z.object({ confirmarExclusao: z.literal(true) }));
    expect(j.properties!.confirmarExclusao).toMatchObject({ type: "boolean", const: true });
    expect(j.required).toContain("confirmarExclusao");
  });
});
