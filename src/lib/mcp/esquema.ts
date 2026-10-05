import { z } from "zod";

/**
 * ZOD → JSON SCHEMA, no subconjunto que as ferramentas deste MCP usam.
 *
 * ⚠ Por que não uma biblioteca: o MCP precisa publicar o `inputSchema` de cada
 * ferramenta em JSON Schema, e o zod já está no projeto para validar a entrada.
 * As duas alternativas eram escrever cada esquema **duas vezes** — em zod e em
 * JSON, que é garantia de divergirem — ou trazer `zod-to-json-schema`, uma
 * dependência inteira para converter sete tipos.
 *
 * ⚠ Ele é deliberadamente PARCIAL, e falha alto no que não cobre. Devolver
 * `{}` para um tipo desconhecido seria pior que lançar: a ferramenta subiria
 * anunciando "aceito qualquer coisa", e o cliente de IA mandaria qualquer
 * coisa. Um esquema errado num MCP não dá erro de compilação — dá chamada
 * malformada em produção, meses depois.
 */

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  const?: unknown;
}

type Def = { typeName: z.ZodFirstPartyTypeKind } & Record<string, unknown>;

export function paraJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as Def;
  const descricao = schema.description;
  const comDescricao = (j: JsonSchema): JsonSchema =>
    descricao ? { description: descricao, ...j } : j;

  const K = z.ZodFirstPartyTypeKind;

  switch (def.typeName) {
    case K.ZodString: {
      const j: JsonSchema = { type: "string" };
      for (const c of (def.checks as Array<Record<string, unknown>>) ?? []) {
        if (c.kind === "min") j.minLength = c.value as number;
        if (c.kind === "max") j.maxLength = c.value as number;
        if (c.kind === "regex") j.pattern = (c.regex as RegExp).source;
      }
      return comDescricao(j);
    }

    case K.ZodNumber: {
      const j: JsonSchema = { type: "number" };
      for (const c of (def.checks as Array<Record<string, unknown>>) ?? []) {
        if (c.kind === "min") j.minimum = c.value as number;
        if (c.kind === "max") j.maximum = c.value as number;
        if (c.kind === "int") j.type = "integer";
      }
      return comDescricao(j);
    }

    case K.ZodBoolean:
      return comDescricao({ type: "boolean" });

    case K.ZodLiteral:
      // `type` junto de `const`: alguns clientes MCP rejeitam (ou ignoram) um esquema com
      // `const` sem tipo, e então não sabem que `confirmarExclusao` é um booleano.
      return comDescricao(
        typeof def.value === "string" || typeof def.value === "number" || typeof def.value === "boolean"
          ? { type: typeof def.value, const: def.value }
          : { const: def.value },
      );

    case K.ZodEnum:
      return comDescricao({ type: "string", enum: [...(def.values as string[])] });

    case K.ZodNativeEnum:
      return comDescricao({ enum: Object.values(def.values as Record<string, unknown>) });

    case K.ZodArray:
      return comDescricao({
        type: "array",
        items: paraJsonSchema(def.type as z.ZodTypeAny),
      });

    case K.ZodObject: {
      const forma = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [chave, valor] of Object.entries(forma)) {
        properties[chave] = paraJsonSchema(valor);
        if (!ehOpcional(valor)) required.push(chave);
      }
      const j: JsonSchema = { type: "object", properties };
      if (required.length) j.required = required;
      // ⚠ Fechado de propósito. Um cliente de IA que inventa um campo precisa
      // ouvir "esse campo não existe" — não ser silenciosamente ignorado e
      // achar que a chamada fez o que ele pediu.
      j.additionalProperties = false;
      return comDescricao(j);
    }

    case K.ZodOptional:
      return paraJsonSchema(def.innerType as z.ZodTypeAny);

    case K.ZodNullable: {
      const interno = paraJsonSchema(def.innerType as z.ZodTypeAny);
      const tipo = interno.type;
      if (typeof tipo === "string") return { ...interno, type: [tipo, "null"] };
      return { ...interno, anyOf: [{ type: "null" }] };
    }

    case K.ZodDefault: {
      const interno = paraJsonSchema(def.innerType as z.ZodTypeAny);
      return { ...interno, default: (def.defaultValue as () => unknown)() };
    }

    case K.ZodUnion: {
      const opcoes = (def.options as z.ZodTypeAny[]).map(paraJsonSchema);
      return comDescricao({ anyOf: opcoes });
    }

    case K.ZodRecord:
      return comDescricao({
        type: "object",
        additionalProperties: paraJsonSchema(def.valueType as z.ZodTypeAny),
      });

    case K.ZodAny:
    case K.ZodUnknown:
      return comDescricao({});

    default:
      throw new Error(
        `paraJsonSchema não cobre ${String(def.typeName)}. ` +
          "Acrescente o caso em src/lib/mcp/esquema.ts — não devolva {} por omissão: " +
          "uma ferramenta que anuncia aceitar qualquer coisa recebe qualquer coisa.",
      );
  }
}

/** Opcional para o JSON Schema = pode faltar. Default também pode faltar. */
function ehOpcional(schema: z.ZodTypeAny): boolean {
  const t = (schema._def as Def).typeName;
  return (
    t === z.ZodFirstPartyTypeKind.ZodOptional ||
    t === z.ZodFirstPartyTypeKind.ZodDefault ||
    t === z.ZodFirstPartyTypeKind.ZodAny ||
    t === z.ZodFirstPartyTypeKind.ZodUnknown
  );
}
