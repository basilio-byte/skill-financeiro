import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx/writer";
import { lerAba } from "@/lib/xlsx/inspecionar";
import {
  NOME_TOTAL_ESCOPOS,
  descreverPedidoMetas,
  lerPedidoMetas,
  montarAbasMetas,
  nomeDoArquivoMetas,
  rotuloPeriodoMeta,
  totalDoAno,
  type EscopoMeta,
  type EventoMeta,
  type LinhaMeta,
} from "@/lib/exportacao/pasta-metas";
import {
  descreverPedidoRegras,
  lerPedidoRegras,
  montarAbasRegras,
  nomeDoArquivoRegras,
  type LinhaRegra,
  type Pendencia,
} from "@/lib/exportacao/pasta-regras";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const usuario = { id: "u", nome: "Admin", email: "a@t", papel: "ADMIN" as const };
const geradoEm = new Date("2026-11-04T20:00:00Z");

describe("metas — pedido", () => {
  it("ano padrão, as duas granularidades por padrão e escopos em lista", () => {
    const { pedido, erros } = lerPedidoMetas({}, 2026);
    expect(erros).toEqual([]);
    expect(pedido).toEqual({ ano: 2026, granularidades: ["MES", "TRIMESTRE"], escopos: [] });
    expect(lerPedidoMetas({ tipo: "mensal", escopo: ["a", "b"], ano: "2025" }, 2026).pedido).toEqual({ ano: 2025, granularidades: ["MES"], escopos: ["a", "b"] });
    expect(lerPedidoMetas({ tipo: ["mensal", "trimestral"] }, 2026).pedido.granularidades).toEqual(["MES", "TRIMESTRE"]);
  });

  it("valor malformado vira ERRO", () => {
    expect(lerPedidoMetas({ ano: "26" }, 2026).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoMetas({ ano: "2101" }, 2026).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoMetas({ tipo: "semestral" }, 2026).erros[0]).toMatch(/Tipo de meta desconhecido/);
  });

  it("rótulos de período e nome do arquivo", () => {
    expect(rotuloPeriodoMeta("MES", "2026-10")).toBe("Outubro de 2026");
    expect(rotuloPeriodoMeta("MES", "2026-03")).toBe("Março de 2026");
    expect(rotuloPeriodoMeta("TRIMESTRE", "2026-Q4")).toBe("4º trimestre de 2026");
    expect(nomeDoArquivoMetas({ ano: 2026, granularidades: ["MES"], escopos: [] })).toBe("Metas_2026.xlsx");
    expect(nomeDoArquivoMetas({ ano: 2026, granularidades: ["MES"], escopos: [] }, "csv")).toBe("Metas_2026.csv");
    expect(descreverPedidoMetas({ ano: 2026, granularidades: ["MES", "TRIMESTRE"], escopos: [] })).toEqual([
      ["Ano", "2026"],
      ["Tipo de meta", "mensal e trimestral"],
      ["Escopos", "todos os escopos ativos"],
    ]);
  });
});

describe("metas — montagem das abas", () => {
  const linha = (p: Partial<LinhaMeta>): LinhaMeta => ({
    granularidade: "MES", periodoChave: "2026-10", situacao: "encerrado", escopoSlug: "salas", escopoNome: "Salas Privativas", abrangeTudo: false,
    ehTotal: false, meta: "40000.00", realizado: "36600.00", percentual: 91.5, falta: "3400.00", ...p,
  });
  const linhas: LinhaMeta[] = [
    linha({ granularidade: "TRIMESTRE", periodoChave: "2026-Q4", situacao: "em andamento" }),
    linha({ periodoChave: "2026-11", situacao: "em andamento", meta: null, percentual: null, falta: null, realizado: "0.10" }),
    linha({}),
    linha({ escopoSlug: "total", escopoNome: "Total recebido", abrangeTudo: true, realizado: "0.20", meta: null, percentual: null, falta: null }),
    linha({ ehTotal: true, escopoSlug: "", escopoNome: NOME_TOTAL_ESCOPOS }),
  ];
  const eventos: EventoMeta[] = [{ quando: new Date("2026-11-04T17:00:00Z"), granularidade: "MES", periodoChave: "2026-10", escopoNome: "Salas Privativas", de: "39000.00", para: "40000.00", por: "Duda" }];
  const escopos: EscopoMeta[] = [
    { slug: "salas", nome: "Salas Privativas", abrangeTudo: false, ativo: true, categorias: ["Salas Privativas -  Sebrae", "Salas Privativas - Seaway Center"] },
    { slug: "total", nome: "Total recebido", abrangeTudo: true, ativo: true, categorias: [] },
  ];
  const abas = montarAbasMetas({ linhas, eventos, escopos, pedido: { ano: 2026, granularidades: ["MES", "TRIMESTRE"], escopos: [] }, geradoEm, usuario, frescor: { texto: "ok", alerta: false } });

  it("abas na ordem e mensal antes de trimestral, em ordem de período", () => {
    expect(abas.abas.map((a) => a.name)).toEqual(["Metas e realizado", "Histórico de alterações", "Escopos", "Leia-me"]);
    expect(abas.nLinhas).toBe(5);
    const m = lerAba(buildXlsx(abas.abas), "Metas e realizado").linhas;
    expect(m[0]).toEqual(["Tipo", "Período", "Chave", "Situação do período", "Escopo", "Soma todas as categorias", "Meta", "Realizado", "% atingido", "Falta para a meta"]);
    expect(m.slice(1, 6).map((r) => `${r[0]} ${r[2]}`)).toEqual(["Mensal 2026-10", "Mensal 2026-10", "Mensal 2026-10", "Mensal 2026-11", "Trimestral 2026-Q4"]);
  });

  it("percentual com duas casas, 'todas as categorias' marcado e a linha de total sem 'Sim/Não'", () => {
    const m = lerAba(buildXlsx(abas.abas), "Metas e realizado").linhas;
    const salas = m.find((r) => r[4] === "Salas Privativas" && r[2] === "2026-10")!;
    expect(salas.slice(5)).toEqual(["Não", "40000.00", "36600.00", "91.50", "3400.00"]);
    expect(m.find((r) => r[4] === "Total recebido")![5]).toBe("Sim");
    expect(m.find((r) => r[4] === NOME_TOTAL_ESCOPOS)![5]).toBe("—");
    expect(m.find((r) => r[2] === "2026-11")!.slice(6, 9)).toEqual(["", "0.10", ""]); // sem meta: meta e % em branco, realizado mostrado
  });

  it("não há linha TOTAL somando as metas (as linhas não são aditivas) e o aviso diz isso", () => {
    const t = lerAba(buildXlsx(abas.abas), "Metas e realizado").linhas;
    expect(t.some((r) => r[0] === "TOTAL")).toBe(false);
    expect(t.flat().join(" ")).toContain("NÃO some as linhas");
  });

  it("histórico: quem, quando (relógio de parede), de/para; escopos com o espaçamento EXATO das categorias", () => {
    const buf = buildXlsx(abas.abas);
    const h = lerAba(buf, "Histórico de alterações").linhas[1]!;
    expect(h.slice(1, 7)).toEqual(["Mensal", "Outubro de 2026", "Salas Privativas", "39000.00", "40000.00", "Duda"]);
    const e = lerAba(buf, "Escopos").linhas;
    expect(e[1]![4]).toBe("Salas Privativas -  Sebrae; Salas Privativas - Seaway Center"); // dois espaços preservados
    expect(e[2]![4]).toContain("todas as categorias");
  });

  it("Leia-me: sem os 12 meses (nem os 4 trimestres) do escopo 'todas as categorias' NÃO apura o total do ano — nunca imprime R$ 0,00 como se fosse apuração", () => {
    const texto = lerAba(buildXlsx(abas.abas), "Leia-me").linhas.map((r) => r.join(" | ")).join("\n");
    expect(texto).toMatch(/Receita total do ano \(escopo 'todas as categorias'\) \| não apurada neste recorte/);
    expect(texto).not.toMatch(/Receita total do ano[^\n]*R\$/);
    expect(texto).toContain("RECATEGORIZADO");
    expect(texto).toContain("Gerado por | Admin (a@t)");
  });

  describe("total do ano do Leia-me", () => {
    const linha = (g: "MES" | "TRIMESTRE", chave: string, realizado: string, slug = "total", abrangeTudo = true) =>
      ({ granularidade: g, periodoChave: chave, situacao: "encerrado", escopoSlug: slug, escopoNome: slug, abrangeTudo, ehTotal: false, meta: null, realizado, percentual: null, falta: null }) as const;
    const meses = (valores: string[], slug = "total") => valores.map((v, i) => linha("MES", `2026-${String(i + 1).padStart(2, "0")}`, v, slug));
    const doze = (a: string, b: string) => meses([a, b, ...Array(10).fill("0.00")] as string[]);

    it("soma os 12 meses em decimal exato (0,10 + 0,20 não vira 0,30000000000000004)", () => {
      const [rotulo, valor] = totalDoAno(doze("0.10", "0.20") as never);
      expect(rotulo).toBe("Receita total do ano (escopo 'todas as categorias'), soma dos meses");
      expect(valor).toMatch(/^R\$\s0,30$/);
    });

    it("sem os meses, usa os 4 trimestres do mesmo escopo", () => {
      const tri = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"].map((c, i) => linha("TRIMESTRE", c, ["100.00", "200.00", "300.00", "400.00"][i]!));
      const [rotulo, valor] = totalDoAno(tri as never);
      expect(rotulo).toContain("soma dos trimestres");
      expect(valor).toMatch(/^R\$\s1\.000,00$/);
    });

    it("recorte incompleto (menos de 12 meses e menos de 4 trimestres) ou sem o escopo global: não apura", () => {
      expect(totalDoAno(meses(["1.00", "2.00"]) as never)[1]).toMatch(/^não apurada/);
      expect(totalDoAno([linha("MES", "2026-01", "5.00", "salas", false)] as never)[1]).toMatch(/^não apurada/);
      expect(totalDoAno([] as never)[1]).toMatch(/^não apurada/);
    });

    it("dois escopos 'todas as categorias': soma só o primeiro (somar os dois contaria o ano em dobro)", () => {
      const dois = [...meses(Array(12).fill("1.00") as string[], "total"), ...meses(Array(12).fill("1.00") as string[], "outro-total")];
      expect(totalDoAno(dois as never)[1]).toMatch(/^R\$\s12,00$/);
    });
  });
});

describe("regras — pedido", () => {
  it("padrões, erros e descrição", () => {
    const { pedido, erros } = lerPedidoRegras({});
    expect(erros).toEqual([]);
    expect(pedido).toEqual({ categorias: [], ativo: "todas", busca: null, pendencias: false, resumos: false }); // a planilha é para os dados
    expect(lerPedidoRegras({ f: "1" }).pedido.pendencias).toBe(false);
    expect(lerPedidoRegras({ f: "1", pendencias: "1", ativo: "ativas", busca: "Batial", categoria: ["A", "B"] }).pedido).toEqual({ categorias: ["A", "B"], ativo: "ativas", busca: "Batial", pendencias: true, resumos: false });
    expect(lerPedidoRegras({ ativo: "talvez" }).erros[0]).toMatch(/Situação da regra desconhecida/);
    expect(lerPedidoRegras({ busca: "a" }).erros[0]).toMatch(/ao menos 2/);
    expect(descreverPedidoRegras(pedido)).toEqual([["Situação das regras", "todas (ativas e inativas)"], ["Outros filtros", "nenhum"]]);
    expect(nomeDoArquivoRegras("2026-11-04")).toBe("Regras_de_categoria_2026-11-04.xlsx");
    expect(nomeDoArquivoRegras("2026-11-04", "csv")).toBe("Regras_de_categoria_2026-11-04.csv");
  });
});

describe("regras — montagem das abas", () => {
  const regra = (p: Partial<LinhaRegra>): LinhaRegra => ({ nome: "Plano X", categoria: "Endereço Fiscal", ativo: true, criadoEm: dia("2026-07-01"), atualizadoEm: dia("2026-07-02"), ...p });
  const regras: LinhaRegra[] = [
    regra({ nome: "Sala 02", categoria: "Salas Privativas -  Sebrae" }),
    regra({ nome: "Batial Mensal" }),
    regra({ nome: "Abissal Mensal", ativo: false }),
    regra({ nome: "Sala 01", categoria: "Salas Privativas - Seaway Center" }),
  ];
  const pendencias: Pendencia[] = [
    { nome: "Serviço novo  com espaço duplo", linhas: 3, valor: "0.10", primeiroCredito: dia("2026-09-01"), ultimoCredito: dia("2026-10-30") },
    { nome: "Outro", linhas: 1, valor: "0.20", primeiroCredito: null, ultimoCredito: null },
  ];
  const entrada = { regras, pendencias, geradoEm, usuario };

  it("ordena por categoria e nome, preserva o espaçamento exato e soma as pendências em decimal exato", () => {
    const pasta = montarAbasRegras({ ...entrada, pedido: { categorias: [], ativo: "todas", busca: null, pendencias: true, resumos: true } });
    expect(pasta.abas.map((a) => a.name)).toEqual(["Regras", "Por categoria", "Sem categoria", "Leia-me"]);
    expect(pasta.nLinhas).toBe(4);
    const buf = buildXlsx(pasta.abas);
    const r = lerAba(buf, "Regras").linhas;
    expect(r.slice(1, 5).map((x) => `${x[1]}|${x[0]}`)).toEqual([
      "Endereço Fiscal|Abissal Mensal",
      "Endereço Fiscal|Batial Mensal",
      "Salas Privativas -  Sebrae|Sala 02", // dois espaços preservados
      "Salas Privativas - Seaway Center|Sala 01",
    ]);
    const c = lerAba(buf, "Por categoria").linhas;
    expect(c.find((x) => x[0] === "Endereço Fiscal")!.slice(1, 4)).toEqual(["1", "1", "2"]);
    expect(c.find((x) => x[0] === "TOTAL")!.slice(1, 4)).toEqual(["3", "1", "4"]);
    const p = lerAba(buf, "Sem categoria").linhas;
    expect(p.find((x) => x[0] === "TOTAL")![2]).toBe("0.30"); // 0,10 + 0,20 exato
    expect(p[1]![0]).toBe("Serviço novo  com espaço duplo");
  });

  it("o padrão abre nos DADOS: só Regras e o Leia-me por último (resumo por categoria e Sem categoria são opcionais)", () => {
    const pasta = montarAbasRegras({ ...entrada, pedido: { categorias: [], ativo: "todas", busca: null, pendencias: false, resumos: false } });
    expect(pasta.abas.map((a) => a.name)).toEqual(["Regras", "Leia-me"]);
    // o Leia-me continua contando as categorias distintas mesmo sem a aba de resumo
    expect(lerAba(buildXlsx(pasta.abas), "Leia-me").linhas.map((r) => r.join(" | ")).join("\n")).toContain("Categorias distintas | 3");
  });

  it("sem pendências no pedido, a aba não existe; o Leia-me conta ativas e categorias", () => {
    const pasta = montarAbasRegras({ ...entrada, pedido: { categorias: [], ativo: "todas", busca: null, pendencias: false, resumos: true } });
    expect(pasta.abas.map((a) => a.name)).toEqual(["Regras", "Por categoria", "Leia-me"]);
    const texto = lerAba(buildXlsx(pasta.abas), "Leia-me").linhas.map((r) => r.join(" | ")).join("\n");
    expect(texto).toContain("Regras exportadas | 4");
    expect(texto).toContain("Ativas | 3");
    expect(texto).toContain("Categorias distintas | 3");
    expect(texto).toContain("dois espaços");
  });
});
