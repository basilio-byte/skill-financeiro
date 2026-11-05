import { describe, expect, it } from "vitest";
import { GRUPOS_PADRAO_RECEITA } from "./colunas-receita";
import { lerFiltrosReceita } from "./filtros-receita";
import { exigirUnicos, lerSimNao } from "./parametros";
import { lerPedidoAcessos } from "./pasta-acessos";
import { lerPedidoClickUp } from "./pasta-clickup";
import { lerPedidoConflitos } from "./pasta-conflitos";
import { lerPedidoInadimplencia } from "./pasta-inadimplencia";
import { lerPedidoMetas } from "./pasta-metas";
import { lerPedidoRegras } from "./pasta-regras";
import { lerPedidoSincronizacoes } from "./pasta-sincronizacoes";

/**
 * O que a URL pede de forma EXPLÍCITA nunca é ignorado em silêncio (ADR-0035, decisão 9): grupo de colunas, `resumos=0|1`,
 * `itens=0|1` valem com ou sem `f=1`, e um parâmetro de valor único repetido com valores diferentes é erro.
 */

describe("exigirUnicos", () => {
  it("só reclama de repetição com valores DIFERENTES (o mesmo valor ou o branco são inofensivos)", () => {
    const erros: string[] = [];
    exigirUnicos({ mes: "2026-09", de: ["2026-09-01", "2026-09-01"], ate: ["", "2026-09-30"], q: undefined }, ["mes", "de", "ate", "q", "ausente"], erros);
    expect(erros).toEqual([]);
    exigirUnicos({ mes: ["2026-09", "2026-10"], de: ["a", "b", "c"] }, ["mes", "de"], erros);
    expect(erros).toEqual([
      'O parâmetro "mes" foi enviado 2 vezes com valores diferentes: envie um só.',
      'O parâmetro "de" foi enviado 3 vezes com valores diferentes: envie um só.',
    ]);
  });
});

describe("lerSimNao", () => {
  const ler = (v: string | string[] | undefined, padrao: boolean, enviado: boolean) => {
    const erros: string[] = [];
    const r = lerSimNao({ x: v }, "x", "Caixa X", padrao, enviado, erros);
    return { r, erros };
  };

  it("o valor explícito vale sempre, com ou sem f=1", () => {
    for (const enviado of [true, false]) {
      for (const padrao of [true, false]) {
        expect(ler("1", padrao, enviado)).toEqual({ r: true, erros: [] });
        expect(ler("0", padrao, enviado)).toEqual({ r: false, erros: [] });
      }
    }
  });

  it("ausente ou em branco: desmarcada com f=1, o padrão sem f", () => {
    expect(ler(undefined, true, true).r).toBe(false);
    expect(ler("", true, true).r).toBe(false);
    expect(ler(undefined, true, false).r).toBe(true);
    expect(ler("", false, false).r).toBe(false);
  });

  it("qualquer outro valor é ERRO (nunca vira 'ligado' por acaso)", () => {
    expect(ler("sim", true, false).erros).toEqual(['Caixa X: valor desconhecido ("sim"): use 1 ou 0.']);
    expect(ler("true", true, true).erros).toHaveLength(1);
  });
});

describe("receita", () => {
  it("grupo pedido de forma explícita vale SEM f=1 (e o padrão só vale quando nada foi pedido)", () => {
    expect(lerFiltrosReceita({}).filtros.grupos).toEqual([...GRUPOS_PADRAO_RECEITA]);
    expect(lerFiltrosReceita({ grupos: "sensiveis" }).filtros.grupos).toEqual(["sensiveis"]);
    expect(lerFiltrosReceita({ grupos: ["fatura", "auditoria"] }).filtros.grupos).toEqual(["fatura", "auditoria"]);
    // pedir só o fixo ("essenciais") também é um pedido: nenhuma coluna opcional
    expect(lerFiltrosReceita({ grupos: "essenciais" }).filtros.grupos).toEqual([]);
    expect(lerFiltrosReceita({ f: "1" }).filtros.grupos).toEqual([]);
  });

  it("resumos e itens: 0/1 explícito vale sem f; valor estranho é erro", () => {
    expect(lerFiltrosReceita({ resumos: "0" }).filtros.resumos).toBe(false);
    expect(lerFiltrosReceita({}).filtros.resumos).toBe(false); // padrão: só os dados
    expect(lerFiltrosReceita({ resumos: "1" }).filtros.resumos).toBe(true);
    expect(lerFiltrosReceita({ itens: "1" }).filtros.itens).toBe(true);
    expect(lerFiltrosReceita({}).filtros.itens).toBe(false);
    expect(lerFiltrosReceita({ f: "1", itens: "0" }).filtros.itens).toBe(false);
    expect(lerFiltrosReceita({ itens: "talvez" }).erros[0]).toMatch(/Aba Itens: valor desconhecido \("talvez"\)/);
    expect(lerFiltrosReceita({ resumos: "x" }).erros[0]).toMatch(/Abas de resumo: valor desconhecido/);
  });

  it("parâmetro único repetido com valores diferentes é erro (não pega o primeiro em silêncio)", () => {
    expect(lerFiltrosReceita({ mes: ["2026-09", "2026-10"] }).erros).toEqual(['O parâmetro "mes" foi enviado 2 vezes com valores diferentes: envie um só.']);
    expect(lerFiltrosReceita({ mes: ["2026-09", "2026-09"] }).erros).toEqual([]);
    expect(lerFiltrosReceita({ cliente: ["Ana", "Ivo"], fatura: ["1", "2"] }).erros).toHaveLength(2);
  });
});

describe("inadimplentes", () => {
  it("grupo explícito vale sem f=1; resumos 0/1 explícito vale; repetição divergente é erro", () => {
    expect(lerPedidoInadimplencia({ grupos: "contato" }).pedido.grupos).toEqual(["contato"]);
    expect(lerPedidoInadimplencia({}).pedido.grupos).toEqual([]);
    expect(lerPedidoInadimplencia({ resumos: "0" }).pedido.resumos).toBe(false);
    expect(lerPedidoInadimplencia({}).pedido.resumos).toBe(false);
    expect(lerPedidoInadimplencia({ resumos: "1" }).pedido.resumos).toBe(true);
    expect(lerPedidoInadimplencia({ resumos: "talvez" }).erros[0]).toMatch(/Abas de resumo: valor desconhecido/);
    expect(lerPedidoInadimplencia({ status: ["unpaid", "juridical"] }).erros[0]).toMatch(/enviado 2 vezes/);
  });
});

describe("regras, metas, conflitos, ClickUp, sincronizações e acessos", () => {
  it("regras: pendencias explícita vale sem f; ativo repetido é erro", () => {
    expect(lerPedidoRegras({ pendencias: "1" }).pedido.pendencias).toBe(true);
    expect(lerPedidoRegras({}).pedido.pendencias).toBe(false);
    expect(lerPedidoRegras({ resumos: "1" }).pedido.resumos).toBe(true);
    expect(lerPedidoRegras({}).pedido.resumos).toBe(false);
    expect(lerPedidoRegras({ pendencias: "talvez" }).erros[0]).toMatch(/Aba Sem categoria: valor desconhecido/);
    expect(lerPedidoRegras({ ativo: ["ativas", "inativas"] }).erros[0]).toMatch(/"ativo" foi enviado 2 vezes/);
  });

  it("metas: ano repetido com valores diferentes é erro", () => {
    expect(lerPedidoMetas({ ano: ["2025", "2026"] }, 2026).erros[0]).toMatch(/"ano" foi enviado 2 vezes/);
    expect(lerPedidoMetas({ ano: ["2026", "2026"] }, 2026).erros).toEqual([]);
  });

  it("conflitos: resumos 0/1 explícito vale sem f", () => {
    expect(lerPedidoConflitos({ resumos: "0" }).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({}).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({ resumos: "1" }).pedido.resumos).toBe(true);
    expect(lerPedidoConflitos({ resumos: ["0", "1"] }).erros[0]).toMatch(/"resumos" foi enviado 2 vezes/);
  });

  it("ClickUp: somenteAtivos 0/1 explícito vale sem f; com f=1 a caixa ausente é desmarcada", () => {
    expect(lerPedidoClickUp({}, "2026-11-04").pedido.somenteAtivos).toBe(true);
    expect(lerPedidoClickUp({ somenteAtivos: "0" }, "2026-11-04").pedido.somenteAtivos).toBe(false);
    expect(lerPedidoClickUp({ f: "1" }, "2026-11-04").pedido.somenteAtivos).toBe(false);
    expect(lerPedidoClickUp({ f: "1", somenteAtivos: "1" }, "2026-11-04").pedido.somenteAtivos).toBe(true);
    expect(lerPedidoClickUp({ somenteAtivos: "talvez" }, "2026-11-04").erros[0]).toMatch(/Somente vínculos ativos: valor desconhecido/);
  });

  it("sincronizações e acessos: datas repetidas com valores diferentes são erro", () => {
    expect(lerPedidoSincronizacoes({ de: ["2026-10-01", "2026-10-15"] }).erros[0]).toMatch(/"de" foi enviado 2 vezes/);
    expect(lerPedidoAcessos({ abas: "acessos", ate: ["2026-10-01", "2026-10-02"] }).erros[0]).toMatch(/"ate" foi enviado 2 vezes/);
  });
});
