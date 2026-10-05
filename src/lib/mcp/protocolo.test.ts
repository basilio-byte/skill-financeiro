import { describe, expect, it } from "vitest";
import { z } from "zod";
import Decimal from "decimal.js";
import { atender, VERSAO_PROTOCOLO, resultado, type Servidor } from "./protocolo";
import { ferramenta } from "./tipos";

const somar = ferramenta({
  nome: "somar",
  titulo: "Somar",
  descricao: "Soma dois números.",
  entrada: z.object({ a: z.number(), b: z.number() }),
  somenteLeitura: true,
  executar: async ({ a, b }) => ({ soma: a + b }),
});

const explodir = ferramenta({
  nome: "explodir",
  titulo: "Explodir",
  descricao: "Lança sempre.",
  entrada: z.object({}),
  somenteLeitura: false,
  executar: async () => {
    throw new Error("o cliente 42 não existe no espelho");
  },
});

const servidor: Servidor = {
  ferramentas: [somar, explodir],
  contexto: { quem: "teste via MCP", origem: "MCP", userId: "u1", tokenId: "t1" },
};

const req = (method: string, params?: Record<string, unknown>, id: number | null = 1) => ({
  jsonrpc: "2.0" as const,
  id,
  method,
  params,
});

describe("protocolo MCP", () => {
  it("negocia a versão que o cliente pede, quando é uma que atendemos", async () => {
    const r = await atender(req("initialize", { protocolVersion: "2024-11-05" }), servidor);
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
  });

  it("cai na nossa versão quando a pedida é desconhecida", async () => {
    const r = await atender(req("initialize", { protocolVersion: "1999-01-01" }), servidor);
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe(VERSAO_PROTOCOLO);
  });

  it("entrega as instruções no initialize", async () => {
    const r = await atender(req("initialize"), servidor);
    const inst = (r?.result as { instructions: string }).instructions;
    // As regras de ouro precisam chegar ao cliente: é o único texto que ele lê
    // sem ser perguntado.
    expect(inst).toMatch(/CONFIRA A FRESCOR ANTES DE AFIRMAR UM NÚMERO/);
    // O Conexa exige reCAPTCHA no login (2026-10-05): um agente que não souber disso
    // tentaria sincronizar em laço.
    expect(inst).toMatch(/reCAPTCHA/);
    expect(inst).toMatch(/RECATEGORIZA COM AS REGRAS DE HOJE/);
    expect(inst).toMatch(/confirmarExclusao=true/);
  });

  it("publica as ferramentas com inputSchema e anotações", async () => {
    const r = await atender(req("tools/list"), servidor);
    const tools = (r?.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools).toHaveLength(2);
    const t = tools[0] as { name: string; inputSchema: { required: string[] }; annotations: { readOnlyHint: boolean } };
    expect(t.name).toBe("somar");
    expect(t.inputSchema.required).toEqual(["a", "b"]);
    expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("chama a ferramenta e devolve texto E estruturado", async () => {
    const r = await atender(req("tools/call", { name: "somar", arguments: { a: 2, b: 3 } }), servidor);
    const res = r?.result as { content: Array<{ text: string }>; structuredContent: unknown; isError: boolean };
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0]!.text)).toEqual({ soma: 5 });
    // ⚠ Os dois juntos, sempre: cliente antigo só lê `content`, novo prefere o
    // estruturado. Mandar um só funciona no cliente que você testou.
    expect(res.structuredContent).toEqual({ soma: 5 });
  });

  it("argumento inválido volta como RESULTADO com isError, não como erro de protocolo", async () => {
    // ⚠ A distinção é o que permite o modelo se corrigir: erro JSON-RPC o
    // cliente esconde dele, e ele repete a mesma chamada errada para sempre.
    const r = await atender(req("tools/call", { name: "somar", arguments: { a: "dois" } }), servidor);
    expect(r?.error).toBeUndefined();
    const res = r?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/a:/);
  });

  it("exceção da ferramenta vira mensagem legível, não 500", async () => {
    const r = await atender(req("tools/call", { name: "explodir", arguments: {} }), servidor);
    const res = r?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("o cliente 42 não existe no espelho");
  });

  it("ferramenta desconhecida aponta para tools/list", async () => {
    const r = await atender(req("tools/call", { name: "inexistente" }), servidor);
    expect(r?.error?.message).toMatch(/tools\/list/);
  });

  it("notificação não gera resposta", async () => {
    expect(await atender({ jsonrpc: "2.0", method: "notifications/initialized" }, servidor)).toBeNull();
  });

  it("método desconhecido com id vira -32601", async () => {
    const r = await atender(req("coisas/list"), servidor);
    expect(r?.error?.code).toBe(-32601);
  });

  it("responde lista vazia para resources e prompts, em vez de erro", async () => {
    // Clientes sondam os dois mesmo sem serem anunciados; -32601 aqui só polui
    // o log de erro de quem está integrando.
    expect((await atender(req("resources/list"), servidor))?.result).toEqual({ resources: [] });
    expect((await atender(req("prompts/list"), servidor))?.result).toEqual({ prompts: [] });
  });

  it("recusa mensagem que não é JSON-RPC 2.0", async () => {
    expect((await atender({ method: "tools/list", id: 1 }, servidor))?.error?.code).toBe(-32600);
    expect((await atender("nada disso", servidor))?.error?.code).toBe(-32600);
  });
});

describe("serialização do resultado", () => {
  it("Decimal vira string, e não um objeto de três letras", () => {
    // ⚠ `JSON.stringify(new Decimal("1234.56"))` devolve {"s":1,"e":3,"d":[...]}.
    // Dinheiro virando isso num MCP é como um número errado chega a um relatório.
    const r = resultado({ receita: new Decimal("1234.56") });
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)).toEqual({
      receita: "1234.56",
    });
  });

  it("Date vira ISO e BigInt vira número", () => {
    const r = resultado({ em: new Date("2026-09-16T12:00:00Z"), n: 7n });
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)).toEqual({
      em: "2026-09-16T12:00:00.000Z",
      n: 7,
    });
  });

  it("array não vira structuredContent — o campo é para objeto", () => {
    const r = resultado([1, 2]);
    expect(r.structuredContent).toBeUndefined();
  });
});

describe("esquema fechado de verdade (medido no teste de integração, 2026-10-05)", () => {
  it("campo inventado é REJEITADO e a ferramenta NÃO executa", async () => {
    let executou = false;
    const f = ferramenta({
      nome: "mexe",
      titulo: "Mexe",
      descricao: "Altera algo.",
      entrada: z.object({ id: z.string() }),
      somenteLeitura: false,
      executar: async () => {
        executou = true;
        return { ok: true };
      },
    });
    const r = await atender(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mexe", arguments: { id: "a", campoInventado: 1 } } },
      { ferramentas: [f], contexto: { quem: "t via MCP", origem: "MCP", userId: "u", tokenId: "t" } },
    );
    expect((r?.result as { isError: boolean }).isError).toBe(true);
    expect(executou).toBe(false);
    // O agente precisa ler QUAL campo sobrou, para corrigir.
    expect(JSON.stringify(r)).toMatch(/campoInventado/);
  });
});
