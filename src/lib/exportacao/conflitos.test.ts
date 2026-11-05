import { describe, expect, it } from "vitest";
import { buildXlsx, BRL, T } from "@/lib/xlsx/writer";
import { lerAba, lerXml, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { money, sum, toAmountString } from "@/lib/money";
import { classificarConflito, type ClassificacaoConflito, type LinhaConflito } from "@/lib/categorization/classificar-conflito";
import { conferirLeituraDeVolta } from "@/lib/exportacao/conferencia";
import { lerCsv } from "@/lib/exportacao/csv";
import { entregar } from "@/lib/exportacao/empacotar";
import { abaDeDetalhe } from "@/lib/exportacao/planilha";
import { ExportacaoGrandeDemaisError, ExportacaoInconsistenteError, ExportacaoNegadaError, MAX_LINHAS } from "@/lib/exportacao/tipos";
import {
  ABA_DETALHE_CONFLITOS,
  CLASSIFICACOES,
  COLUNAS_CONFLITOS,
  COLUNA_VALOR_CONFLITOS,
  INFO_CLASSIFICACAO,
  TITULOS_COLUNAS_CONFLITOS,
  conferirConflitos,
  conferirDetalhe,
  contarLinhasDosConflitos,
  descreverPedidoConflitos,
  exigirTamanhoSuportado,
  filtrarPorClassificacao,
  juntarComBanco,
  lerPedidoConflitos,
  linhasDoDetalhe,
  montarAbasConflitos,
  nomeDoArquivoConflitos,
  ordenarConflitos,
  resumirConflitos,
  resumirProblemas,
  rotuloClassificacao,
  validarPermissoesConflitos,
  type ClassificacaoTipo,
  type ConflitoDeEntrada,
  type EntradaPastaConflitos,
  type LeituraDoBanco,
  type LinhaDoBanco,
  type LinhaDoDetalhe,
} from "@/lib/exportacao/pasta-conflitos";

/**
 * Hoje as abas de RESUMO vêm DESLIGADAS por padrão (a planilha é para os dados; o painel já resume). Estes testes exercitam os
 * resumos, então pedem explicitamente — a menos que o próprio teste mande `f` (formulário enviado), caso em que vale o que ele mandou.
 */
const comResumos = (params: Record<string, string | string[]>): Record<string, string | string[]> => ("f" in params ? params : { resumos: "1", ...params });

const serialHoraDeParede = (paredeIso: string): string => {
  const ms = Date.parse(paredeIso);
  const dias = Math.floor(ms / 86_400_000);
  return String(dias + 25_569 + (ms - dias * 86_400_000) / 86_400_000);
};

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ---------------------------------------------------------------------------------------------------------------
// Cenário: cinco conflitos (uma fatura em dois meses, os três tipos, texto hostil), classificados pelo classificador REAL
// ---------------------------------------------------------------------------------------------------------------

const SEM = "Sem Categoria";

function cenario() {
  let seq = 0;
  /** O que o "banco" diz de cada linha na segunda leitura (mês e data de crédito). */
  const banco = new Map<string, LinhaDoBanco>();

  const linha = (crConexaId: number, mes: string, data: Date | null, p: Partial<LinhaConflito> & Pick<LinhaConflito, "categoria" | "valorRecebidoCat">): LinhaConflito => {
    seq += 1;
    const l: LinhaConflito = {
      id: `ln${seq}`,
      chaveLinha: p.categoria,
      servicoOuPlano: "Serviço X",
      revisadoManualmente: false,
      revisadoPorNome: null,
      revisadoEm: null,
      categoriaOriginal: null,
      valorRecebidoCatOriginal: null,
      ...p,
    };
    banco.set(l.id, { crConexaId, chaveLinha: l.chaveLinha, mesCredito: mes, dataCredito: data, valorRecebidoCat: l.valorRecebidoCat });
    return l;
  };

  /** Monta o conflito do JEITO de `listarConflitos`: soma e diferença em decimal, classificação pelo classificador de verdade. */
  const conflito = (crConexaId: number, razaoSocial: string | null, valorFatura: string, linhas: LinhaConflito[]): ConflitoDeEntrada => {
    const soma = sum(linhas.map((l) => l.valorRecebidoCat));
    return {
      crConexaId,
      razaoSocial,
      valorRecebidoTotal: toAmountString(money(valorFatura)),
      somaAtual: toAmountString(soma),
      diferenca: toAmountString(soma.minus(money(valorFatura))),
      linhas,
      classificacao: classificarConflito(linhas),
    };
  };

  // A: duplicata em "Sem Categoria" — linha automática + linha manual com categoria real (excesso de 100,00)
  const A = conflito(1001, "Cliente & Filhos <Ltda>", "100.00", [
    linha(1001, "2026-10", dia("2026-10-15"), { categoria: SEM, valorRecebidoCat: "100.00" }),
    linha(1001, "2026-10", dia("2026-10-15"), {
      categoria: "Salas Privativas - Seaway Center",
      chaveLinha: "Sem Categoria::Cliente Avulso",
      valorRecebidoCat: "100.00",
      revisadoManualmente: true,
      revisadoPorNome: "Duda",
      revisadoEm: "2026-11-04T20:03:00.000Z",
      categoriaOriginal: SEM,
      valorRecebidoCatOriginal: "100.00",
    }),
  ]);
  // B: manual superada — mesma categoria nas duas linhas, com DOIS espaços (grafia real do banco). Excesso de 50,10
  const B = conflito(1002, "Outro Cliente", "50.10", [
    linha(1002, "2026-10", dia("2026-10-20"), { categoria: "Serviços de Espaço -  Sebrae", valorRecebidoCat: "50.10" }),
    linha(1002, "2026-10", dia("2026-10-20"), {
      categoria: "Serviços de Espaço -  Sebrae",
      chaveLinha: "Sem Categoria::X",
      valorRecebidoCat: "50.10",
      revisadoManualmente: true,
      revisadoPorNome: "Duda",
      revisadoEm: "2026-10-21T12:00:00.000Z",
      categoriaOriginal: SEM,
      valorRecebidoCatOriginal: "50.10",
    }),
  ]);
  // C: ambíguo com FALTA — duas linhas automáticas (0,10 + 0,20: em float daria 0.30000000000000004) contra uma fatura de 0,40
  const C = conflito(1003, "Cliente C", "0.40", [
    linha(1003, "2026-09", dia("2026-09-05"), { categoria: "Outros Serviços", valorRecebidoCat: "0.10" }),
    linha(1003, "2026-09", dia("2026-09-05"), { categoria: "Endereço Fiscal", valorRecebidoCat: "0.20" }),
  ]);
  // D: a MESMA fatura 1001, em outro mês de crédito — conflito próprio (uma linha só: ambíguo, falta de 15,50)
  const D = conflito(1001, "Cliente & Filhos <Ltda>", "45.50", [linha(1001, "2026-09", dia("2026-09-15"), { categoria: "Endereço Fiscal", valorRecebidoCat: "30.00" })]);
  // E: texto hostil (fórmula, controle de XML, marcação) e linha sem data de crédito — falta de 3,00
  const E = conflito(1004, '=HYPERLINK("http://evil.example","x")\u0008', "10.00", [
    linha(1004, "2026-10", null, { categoria: "Cat\u0001egoria", servicoOuPlano: "+cmd|' /C calc'!A0", chaveLinha: "k-\u000b", valorRecebidoCat: "7.00" }),
  ]);

  // De propósito FORA de ordem: a planilha tem de sair na ordem da tela, não na da entrada.
  const conflitos = [D, E, C, B, A];

  const leitura = (cs: readonly ConflitoDeEntrada[] = conflitos): LeituraDoBanco => {
    const porId = new Map<string, LinhaDoBanco>();
    for (const c of cs) for (const l of c.linhas) porId.set(l.id, banco.get(l.id)!);
    return { porId, contagem: porId.size, total: toAmountString(sum([...porId.values()].map((b) => b.valorRecebidoCat))) };
  };

  return { A, B, C, D, E, conflitos, banco, leitura };
}

type Cenario = ReturnType<typeof cenario>;

const USUARIO = { id: "u", nome: "Admin", email: "a@t", papel: "ADMIN" as const };
const FRESCOR = { texto: "Receita sincronizando normalmente. Última sincronização concluída em 04/11/2026 16:50 (há 10 min).", alerta: false };
const GERADO_EM = new Date("2026-11-04T20:00:00Z");

function montar(c: Cenario, params: Record<string, string | string[]> = {}, extra: Partial<EntradaPastaConflitos> = {}) {
  const pedido = lerPedidoConflitos(comResumos(params)).pedido;
  const selecionados = filtrarPorClassificacao(c.conflitos, pedido.classificacoes);
  const junto = juntarComBanco(selecionados, c.leitura(selecionados));
  expect(junto.problemas).toEqual([]);
  return montarAbasConflitos({ conflitos: junto.conflitos, totalSemFiltro: c.conflitos.length, pedido, geradoEm: GERADO_EM, usuario: USUARIO, frescor: FRESCOR, ...extra });
}

const textoDoLeiaMe = (buf: Buffer) =>
  lerAba(buf, "Leia-me")
    .linhas.map((r) => r.join(" | "))
    .join("\n");

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

describe("lerPedidoConflitos", () => {
  it("sem parâmetros: todas as classificações, resumos DESLIGADOS (a planilha é para os dados)", () => {
    const { pedido, erros } = lerPedidoConflitos({});
    expect(erros).toEqual([]);
    expect(pedido).toEqual({ classificacoes: [], resumos: false });
  });

  it("classificação pedida: uma, várias (na ordem do catálogo, não na da URL) e repetidas/vazias ignoradas", () => {
    expect(lerPedidoConflitos({ classificacao: "ambiguo" }).pedido.classificacoes).toEqual(["ambiguo"]);
    expect(lerPedidoConflitos({ classificacao: ["manual_superada", "duplicata_sem_categoria"] }).pedido.classificacoes).toEqual(["duplicata_sem_categoria", "manual_superada"]);
    const r = lerPedidoConflitos({ classificacao: ["", "ambiguo", "ambiguo", "  "] });
    expect(r.erros).toEqual([]);
    expect(r.pedido.classificacoes).toEqual(["ambiguo"]);
  });

  it("as três juntas equivalem a nenhum filtro (e o arquivo não leva 'filtrado' no nome)", () => {
    const { pedido } = lerPedidoConflitos({ classificacao: ["ambiguo", "manual_superada", "duplicata_sem_categoria"] });
    expect(pedido.classificacoes).toEqual([]);
    expect(nomeDoArquivoConflitos(pedido, "2026-11-04")).toBe("Conflitos_2026-11-04.xlsx");
  });

  it("valor desconhecido vira ERRO (filtro ignorado em silêncio entregaria todos os conflitos como se fosse o recorte)", () => {
    const r = lerPedidoConflitos({ classificacao: "dupla_contagem" });
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatch(/Classificação desconhecida: "dupla_contagem"/);
    expect(r.erros[0]).toContain("duplicata_sem_categoria, manual_superada, ambiguo");
    // um válido ao lado de um inválido: o inválido continua sendo acusado
    expect(lerPedidoConflitos({ classificacao: ["ambiguo", "x"] }).erros[0]).toMatch(/"x"/);
    // diferença de maiúsculas também é valor desconhecido (a chave é exata)
    expect(lerPedidoConflitos({ classificacao: "Ambiguo" }).erros).toHaveLength(1);
  });

  it("entrada hostil: chaves do protótipo e texto enorme viram erro curto, sem estourar nem passar", () => {
    for (const hostil of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(lerPedidoConflitos({ classificacao: hostil }).erros, hostil).toHaveLength(1);
    }
    const enorme = lerPedidoConflitos({ classificacao: "a".repeat(5000) });
    expect(enorme.erros[0]!.length).toBeLessThan(200);
    const muitos = lerPedidoConflitos({ classificacao: Array.from({ length: 500 }, (_, i) => `x${i}`) });
    expect(muitos.erros).toHaveLength(1);
    expect(muitos.pedido.classificacoes).toEqual([]);
  });

  it("f=1: a caixa 'resumos' ausente é desmarcada; sem f os resumos vêm desligados; o valor EXPLÍCITO (0 ou 1) vale sempre", () => {
    expect(lerPedidoConflitos({ f: "1" }).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({}).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({ f: "1", resumos: "1" }).pedido.resumos).toBe(true);
    expect(lerPedidoConflitos({ resumos: "0" }).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({ f: "1", resumos: "0" }).pedido.resumos).toBe(false);
    expect(lerPedidoConflitos({ resumos: "talvez" }).erros[0]).toMatch(/Abas de resumo: valor desconhecido \("talvez"\)/);
  });

  it("descrição do recorte e nome do arquivo", () => {
    expect(descreverPedidoConflitos({ classificacoes: [], resumos: true })).toEqual([
      ["Classificação", "todas (Duplicata em Sem Categoria; Revisão manual superada; Ambíguo (decisão manual))"],
      ["Meses de crédito", "todos (a lista não é recortada por período)"],
    ]);
    const duas: ClassificacaoTipo[] = ["manual_superada", "ambiguo"];
    expect(descreverPedidoConflitos({ classificacoes: duas, resumos: true })[0]).toEqual(["Classificação", "Revisão manual superada; Ambíguo (decisão manual)"]);
    const filtrado = { classificacoes: ["ambiguo" as const], resumos: true };
    expect(nomeDoArquivoConflitos(filtrado, "2026-11-04")).toBe("Conflitos_2026-11-04_filtrado.xlsx");
    expect(nomeDoArquivoConflitos(filtrado, "2026-11-04", "csv")).toBe("Conflitos_2026-11-04_filtrado.csv");
  });
});

describe("catálogo de classificações", () => {
  it("toda classificação tem rótulo, significado e o que fazer", () => {
    expect([...CLASSIFICACOES]).toEqual(["duplicata_sem_categoria", "manual_superada", "ambiguo"]);
    for (const t of CLASSIFICACOES) {
      expect(INFO_CLASSIFICACAO[t].rotulo.length, t).toBeGreaterThan(3);
      expect(INFO_CLASSIFICACAO[t].significado.length, t).toBeGreaterThan(40);
      expect(INFO_CLASSIFICACAO[t].acao.length, t).toBeGreaterThan(40);
    }
  });

  it("o catálogo cobre tudo o que o classificador REAL produz (e nada além)", () => {
    const c = cenario();
    const produzidas = new Set(c.conflitos.map((x) => x.classificacao.tipo));
    expect(produzidas).toEqual(new Set(CLASSIFICACOES));
    expect(c.A.classificacao.tipo).toBe("duplicata_sem_categoria");
    expect(c.B.classificacao.tipo).toBe("manual_superada");
    expect(c.C.classificacao.tipo).toBe("ambiguo");
  });

  it("rótulo desconhecido aparece como veio (nunca some)", () => {
    expect(rotuloClassificacao("inventada" as unknown as ClassificacaoTipo)).toBe("inventada");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Permissão, tamanho e filtro
// ---------------------------------------------------------------------------------------------------------------

describe("permissão, tamanho e filtro", () => {
  it("só administrador exporta conflitos (visualizador recebe ExportacaoNegadaError → 403)", () => {
    expect(() => validarPermissoesConflitos({ ...USUARIO, papel: "VIEWER" })).toThrow(ExportacaoNegadaError);
    expect(() => validarPermissoesConflitos({ ...USUARIO, papel: "VIEWER" })).toThrow(/administradores/);
    expect(() => validarPermissoesConflitos(USUARIO)).not.toThrow();
  });

  it("acima de MAX_LINHAS vira ExportacaoGrandeDemaisError com o que fazer; no teto exato passa", () => {
    expect(() => exigirTamanhoSuportado(MAX_LINHAS, 3000)).not.toThrow();
    expect(() => exigirTamanhoSuportado(MAX_LINHAS + 1, 3000)).toThrow(ExportacaoGrandeDemaisError);
    expect(() => exigirTamanhoSuportado(MAX_LINHAS + 1, 3000)).toThrow(/20\.000/);
    expect(() => exigirTamanhoSuportado(MAX_LINHAS + 1, 3000)).toThrow(/uma classificação por vez/);
  });

  it("a aba principal tem uma linha por LINHA de cada conflito (não por conflito)", () => {
    const c = cenario();
    expect(contarLinhasDosConflitos(c.conflitos)).toBe(8);
    expect(c.conflitos).toHaveLength(5);
  });

  it("filtrar por classificação: vazio = todos; o filtro mantém só as pedidas", () => {
    const c = cenario();
    expect(filtrarPorClassificacao(c.conflitos, [])).toHaveLength(5);
    expect(filtrarPorClassificacao(c.conflitos, ["ambiguo"]).map((x) => x.crConexaId).sort()).toEqual([1001, 1003, 1004]);
    expect(filtrarPorClassificacao(c.conflitos, ["duplicata_sem_categoria", "manual_superada"])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Segunda leitura (mês e data de crédito) e conferência contra o banco
// ---------------------------------------------------------------------------------------------------------------

describe("juntarComBanco: a conferência da segunda leitura (prova que ACUSA defeito)", () => {
  it("dado íntegro: nenhuma divergência; cada linha ganha a data de crédito e cada conflito, o mês", () => {
    const c = cenario();
    const r = juntarComBanco(c.conflitos, c.leitura());
    expect(r.problemas).toEqual([]);
    const a = r.conflitos.find((x) => x.crConexaId === 1001 && x.mesCredito === "2026-10")!;
    expect(a.linhas.map((l) => l.dataCredito?.toISOString().slice(0, 10))).toEqual(["2026-10-15", "2026-10-15"]);
    expect(r.conflitos.find((x) => x.crConexaId === 1004)!.linhas[0]!.dataCredito).toBeNull();
    expect(r.conflitos.map((x) => `${x.crConexaId}:${x.mesCredito}`).sort()).toEqual(["1001:2026-09", "1001:2026-10", "1002:2026-10", "1003:2026-09", "1004:2026-10"]);
  });

  it("acusa linha que sumiu entre a lista e a leitura por id (e a contagem e a soma do banco)", () => {
    const c = cenario();
    const leitura = c.leitura();
    leitura.porId.delete(c.A.linhas[0]!.id);
    leitura.contagem -= 1;
    leitura.total = toAmountString(money(leitura.total).minus("100.00"));
    const p = juntarComBanco(c.conflitos, leitura).problemas;
    expect(p.some((x) => x.includes("não está mais no banco"))).toBe(true);
  });

  it("acusa um centavo de diferença no valor de uma linha", () => {
    const c = cenario();
    const leitura = c.leitura();
    const id = c.C.linhas[0]!.id;
    leitura.porId.set(id, { ...leitura.porId.get(id)!, valorRecebidoCat: "0.11" });
    expect(juntarComBanco(c.conflitos, leitura).problemas.some((x) => x.includes("o valor da linha") && x.includes("0.10 → 0.11"))).toBe(true);
  });

  it("acusa chave que mudou e linha que passou a ser de outra fatura", () => {
    const c = cenario();
    const leitura = c.leitura();
    const id = c.B.linhas[1]!.id;
    leitura.porId.set(id, { ...leitura.porId.get(id)!, chaveLinha: "Outra chave", crConexaId: 9999 });
    const p = juntarComBanco(c.conflitos, leitura).problemas;
    expect(p.some((x) => x.includes("a chave da linha"))).toBe(true);
    expect(p.some((x) => x.includes("agora é da fatura 9999"))).toBe(true);
  });

  it("acusa linhas de um conflito em meses de crédito diferentes (quebra o agrupamento de listarConflitos)", () => {
    const c = cenario();
    const leitura = c.leitura();
    const id = c.A.linhas[0]!.id;
    leitura.porId.set(id, { ...leitura.porId.get(id)!, mesCredito: "2026-09" });
    expect(juntarComBanco(c.conflitos, leitura).problemas.some((x) => x.includes("meses de crédito diferentes"))).toBe(true);
  });

  it("acusa contagem do banco diferente e, separadamente, soma do banco diferente", () => {
    const c = cenario();
    const contagem = { ...c.leitura(), contagem: 9 };
    expect(juntarComBanco(c.conflitos, contagem).problemas).toEqual([expect.stringContaining("o banco tem 9 linha(s) para os 8 id(s)")]);
    const soma = { ...c.leitura(), total: "337.51" };
    expect(juntarComBanco(c.conflitos, soma).problemas).toEqual([expect.stringContaining("a soma do banco (337.51) ≠ a soma das linhas da lista (337.50)")]);
  });

  it("lista vazia: nada a conferir, nenhum problema", () => {
    expect(juntarComBanco([], { porId: new Map(), contagem: 0, total: "0.00" })).toEqual({ conflitos: [], problemas: [] });
  });

  it("a mensagem de problemas cabe numa tela: as primeiras e quantas ficaram de fora", () => {
    const muitas = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(resumirProblemas(muitas)).toContain("(+22 divergência(s))");
    expect(resumirProblemas(["a", "b"])).toBe("a; b");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Invariantes da lista (a conferência obrigatória) com defeito injetado
// ---------------------------------------------------------------------------------------------------------------

describe("conferirConflitos: a soma de Valor Cat. fecha com a soma de somaAtual (prova que ACUSA defeito)", () => {
  it("dado íntegro: nenhuma divergência", () => {
    expect(conferirConflitos(cenario().conflitos)).toEqual([]);
  });

  it("acusa uma linha com um centavo a mais (por conflito e na soma geral)", () => {
    const { conflitos } = cenario();
    const adulterados = conflitos.map((c) => (c.crConexaId === 1003 ? { ...c, linhas: c.linhas.map((l, i) => (i === 0 ? { ...l, valorRecebidoCat: "0.11" } : l)) } : c));
    const p = conferirConflitos(adulterados);
    expect(p.some((x) => x.includes("fatura 1003: as linhas somam 0.31, mas a lista informa soma atual 0.30"))).toBe(true);
    expect(p.some((x) => x.includes("a soma de Valor Cat. das linhas (337.51) ≠ a soma das \"soma atual\" dos conflitos (337.50)"))).toBe(true);
  });

  it("acusa linha a menos (leitura truncada)", () => {
    const { conflitos } = cenario();
    const truncados = conflitos.map((c) => (c.crConexaId === 1002 ? { ...c, linhas: c.linhas.slice(0, 1) } : c));
    expect(conferirConflitos(truncados).some((x) => x.includes("fatura 1002: as linhas somam 50.10"))).toBe(true);
  });

  it("acusa diferença que não é soma atual − valor da fatura", () => {
    const { conflitos } = cenario();
    const adulterados = conflitos.map((c) => (c.crConexaId === 1004 ? { ...c, diferenca: "-3.01" } : c));
    expect(conferirConflitos(adulterados).some((x) => x.includes("fatura 1004: a diferença -3.01 ≠ soma atual − valor da fatura (-3.00)"))).toBe(true);
  });

  it("acusa classificação que não corresponde às linhas (mesmo classificador da tela) e classificação desconhecida", () => {
    const { conflitos } = cenario();
    const trocada: ClassificacaoConflito = { tipo: "manual_superada", linhaParaExcluirId: "x", explicacao: "x" };
    const p = conferirConflitos(conflitos.map((c) => (c.crConexaId === 1003 ? { ...c, classificacao: trocada } : c)));
    expect(p.some((x) => x.includes('a classificação "manual_superada" não corresponde às linhas (o classificador diz "ambiguo")'))).toBe(true);
    const desconhecida = conflitos.map((c) => (c.crConexaId === 1003 ? { ...c, classificacao: { tipo: "inventada", explicacao: "x" } as unknown as ClassificacaoConflito } : c));
    expect(conferirConflitos(desconhecida).some((x) => x.includes('classificação desconhecida ("inventada")'))).toBe(true);
  });

  it("acusa a mesma linha em dois conflitos (contaria o dinheiro duas vezes) e conflito sem linhas", () => {
    const { A, C } = cenario();
    const repetida = { ...C, linhas: [A.linhas[0]!, ...C.linhas.slice(1)] };
    expect(conferirConflitos([A, repetida]).some((x) => x.includes("aparece em mais de um conflito"))).toBe(true);
    expect(conferirConflitos([{ ...C, linhas: [] }]).some((x) => x.includes("conflito sem nenhuma linha"))).toBe(true);
  });

  it("a aba principal MONTADA fecha com a lista: a soma da coluna Valor Cat. = Σ soma atual e as linhas = Σ tamanhos (ACUSA defeito)", () => {
    const c = cenario();
    const junto = juntarComBanco(c.conflitos, c.leitura());
    const linhas = linhasDoDetalhe(junto.conflitos);
    const detalheDe = (ls: LinhaDoDetalhe[]) => abaDeDetalhe({ nome: ABA_DETALHE_CONFLITOS, colunas: COLUNAS_CONFLITOS, linhas: ls, colunaTotal: COLUNA_VALOR_CONFLITOS });

    // íntegra
    expect(conferirDetalhe(detalheDe(linhas), c.conflitos)).toEqual([]);

    // um centavo a mais na coluna Valor Cat. de UMA linha (o defeito que um mapeamento de coluna errado produziria)
    const centavo = linhas.map((l, i) => (i === 0 ? { ...l, valorCat: toAmountString(money(l.valorCat).plus("0.01")) } : l));
    expect(conferirDetalhe(detalheDe(centavo), c.conflitos)).toEqual([expect.stringContaining('soma de Valor Cat. (337.51) ≠ soma das "soma atual" dos conflitos (337.50)')]);

    // coluna errada: o valor da FATURA (que se repete em cada linha do conflito) no lugar do Valor Cat. — somaria 356,50
    const colunaErrada = linhas.map((l) => ({ ...l, valorCat: l.valorFatura }));
    expect(conferirDetalhe(detalheDe(colunaErrada), c.conflitos)).toEqual([expect.stringContaining('soma de Valor Cat. (356.50) ≠ soma das "soma atual" dos conflitos (337.50)')]);

    // linha a menos e linha a mais na aba
    expect(conferirDetalhe(detalheDe(linhas.slice(1)), c.conflitos).some((x) => x.includes("7 linha(s) de dados, os conflitos têm 8"))).toBe(true);
    expect(conferirDetalhe(detalheDe([...linhas, linhas[0]!]), c.conflitos).some((x) => x.includes("9 linha(s) de dados, os conflitos têm 8"))).toBe(true);
  });

  it("a montagem recusa a lista com defeito: ExportacaoInconsistenteError, arquivo não entregue", () => {
    const c = cenario();
    const junto = juntarComBanco(c.conflitos, c.leitura());
    const adulterados = junto.conflitos.map((x) => (x.crConexaId === 1003 ? { ...x, linhas: x.linhas.map((l, i) => (i === 0 ? { ...l, valorRecebidoCat: "0.11" } : l)) } : x));
    const tenta = () =>
      montarAbasConflitos({ conflitos: adulterados, totalSemFiltro: 5, pedido: lerPedidoConflitos({ resumos: "1" }).pedido, geradoEm: GERADO_EM, usuario: USUARIO, frescor: FRESCOR });
    expect(tenta).toThrow(ExportacaoInconsistenteError);
    expect(tenta).toThrow(/o arquivo não foi entregue/);
  });

  it("a montagem recusa conflito de classificação que o pedido não incluiu (lista e pedido incoerentes)", () => {
    const c = cenario();
    const junto = juntarComBanco(c.conflitos, c.leitura());
    const tenta = () =>
      montarAbasConflitos({ conflitos: junto.conflitos, totalSemFiltro: 5, pedido: { classificacoes: ["ambiguo"], resumos: true }, geradoEm: GERADO_EM, usuario: USUARIO, frescor: FRESCOR });
    expect(tenta).toThrow(/classificação que o pedido não incluiu/);
  });

  it("data de revisão ilegível é erro (sumir em branco esconderia o defeito)", () => {
    const c = cenario();
    const junto = juntarComBanco(c.conflitos, c.leitura());
    const quebrados = junto.conflitos.map((x) => (x.crConexaId === 1002 ? { ...x, linhas: x.linhas.map((l) => (l.revisadoEm ? { ...l, revisadoEm: "ontem de manhã" } : l)) } : x));
    expect(() => montarAbasConflitos({ conflitos: quebrados, totalSemFiltro: 5, pedido: lerPedidoConflitos({ resumos: "1" }).pedido, geradoEm: GERADO_EM, usuario: USUARIO, frescor: FRESCOR })).toThrow(
      /data de revisão "ontem de manhã" não é uma data válida/,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Resumo, ordem e totais exatos
// ---------------------------------------------------------------------------------------------------------------

describe("resumo e ordem", () => {
  it("excesso, falta e total por classificação, em decimal exato", () => {
    const r = resumirConflitos(cenario().conflitos);
    expect(r.conflitos).toBe(5);
    expect(r.faturas).toBe(4); // a fatura 1001 tem conflito em dois meses: conta uma vez
    expect(r.linhas).toBe(8);
    expect(toAmountString(r.somaAtual)).toBe("337.50");
    expect(toAmountString(r.valorDasFaturas)).toBe("206.00");
    expect(toAmountString(r.excesso)).toBe("150.10"); // 100,00 + 50,10
    expect(r.conflitosComExcesso).toBe(2);
    expect(toAmountString(r.falta)).toBe("18.60"); // 0,10 + 3,00 + 15,50
    expect(r.conflitosComFalta).toBe(3);
    expect(toAmountString(r.somaAbsDiferenca)).toBe("168.70");
    expect(r.porClassificacao.ambiguo).toMatchObject({ conflitos: 3, linhas: 4 });
    expect(toAmountString(r.porClassificacao.ambiguo.somaAbsDiferenca)).toBe("18.60");
    expect(r.porClassificacao.duplicata_sem_categoria).toMatchObject({ conflitos: 1, linhas: 2 });
    expect(toAmountString(r.porClassificacao.manual_superada.somaAbsDiferenca)).toBe("50.10");
  });

  it("0,1 + 0,2 + … nunca vira 0,30000000000000004", () => {
    expect(toAmountString(sum(["0.1", "0.2"]))).toBe("0.30");
    const r = resumirConflitos([cenario().C]);
    expect(toAmountString(r.somaAtual)).toBe("0.30");
  });

  it("ordem da tela: maior diferença (com sinal) primeiro; empate decidido por fatura e mês (nunca ao acaso)", () => {
    const base = { razaoSocial: null, valorRecebidoTotal: "0.00", somaAtual: "0.00", linhas: [], classificacao: { tipo: "ambiguo" as const, explicacao: "" } };
    const v = [
      { ...base, crConexaId: 1005, mesCredito: "2026-10", diferenca: "-5.00" },
      { ...base, crConexaId: 1005, mesCredito: "2026-09", diferenca: "-5.00" },
      { ...base, crConexaId: 1003, mesCredito: "2026-10", diferenca: "-5.00" },
      { ...base, crConexaId: 1009, mesCredito: "2026-01", diferenca: "10.00" },
    ];
    expect(ordenarConflitos(v).map((x) => `${x.crConexaId}:${x.mesCredito}`)).toEqual(["1009:2026-01", "1003:2026-10", "1005:2026-09", "1005:2026-10"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// As abas
// ---------------------------------------------------------------------------------------------------------------

describe("montarAbasConflitos", () => {
  it("abas: Conflitos (principal) primeiro, depois Por fatura e Por classificação, e o Leia-me por ÚLTIMO; sem resumos só Conflitos e Leia-me", () => {
    const c = cenario();
    expect(montar(c).abas.map((a) => a.name)).toEqual(["Conflitos", "Por fatura", "Por classificação", "Leia-me"]);
    expect(montar(c, { f: "1" }).abas.map((a) => a.name)).toEqual(["Conflitos", "Leia-me"]);
    expect(nomesDasAbas(buildXlsx(montar(c).abas))).toEqual(["Conflitos", "Por fatura", "Por classificação", "Leia-me"]);
  });

  it("aba principal: uma linha por LINHA de cada conflito, na ordem da tela, com o cabeçalho do catálogo", () => {
    const s = montar(cenario());
    const det = lerAba(buildXlsx(s.abas), ABA_DETALHE_CONFLITOS).linhas;
    expect(det[0]).toEqual(TITULOS_COLUNAS_CONFLITOS);
    expect(det.slice(1, 9).map((r) => r[0])).toEqual(["1001", "1001", "1002", "1002", "1003", "1003", "1004", "1001"]);
    expect(s.nLinhas).toBe(8);
    expect(s.nConflitos).toBe(5);
  });

  it("o total é a soma EXATA de Valor Cat. e é IGUAL à soma das 'soma atual' dos conflitos (a invariante)", () => {
    const c = cenario();
    const s = montar(c);
    expect(toAmountString(s.total)).toBe("337.50");
    expect(s.detalhe.total).toBe("337.50");
    expect(toAmountString(sum(c.conflitos.map((x) => x.somaAtual)))).toBe("337.50");
    const det = lerAba(buildXlsx(s.abas), ABA_DETALHE_CONFLITOS).linhas;
    const i = s.detalhe.indiceColunaTotal;
    expect(TITULOS_COLUNAS_CONFLITOS[i]).toBe("Valor Cat.");
    expect(toAmountString(sum(det.slice(1, 9).map((r) => r[i]!)))).toBe("337.50");
    expect(det[10]![0]).toBe("TOTAL");
    expect(det[10]![i]).toBe("337.50");
  });

  it("valores do conflito (fatura, soma atual, diferença) repetem em cada linha e têm 'NÃO somar' no título", () => {
    const s = montar(cenario());
    expect(TITULOS_COLUNAS_CONFLITOS.filter((t) => t.includes("NÃO somar"))).toHaveLength(3);
    const det = lerAba(buildXlsx(s.abas), ABA_DETALHE_CONFLITOS).linhas;
    const [iFat, iSoma, iDif] = ["Valor da fatura", "Soma atual", "Diferença"].map((p) => TITULOS_COLUNAS_CONFLITOS.findIndex((t) => t.startsWith(p)));
    expect([det[1]![iFat!], det[1]![iSoma!], det[1]![iDif!]]).toEqual(["100.00", "200.00", "100.00"]);
    expect([det[2]![iFat!], det[2]![iSoma!], det[2]![iDif!]]).toEqual(["100.00", "200.00", "100.00"]); // 2ª linha do mesmo conflito
    expect(det[7]![iDif!]).toBe("-3.00"); // diferença NEGATIVA (falta) sai com sinal
    expect(det[8]![iDif!]).toBe("-15.50");
  });

  it("classificação sai em português e com a chave; revisão manual com quem, quando (relógio de Fortaleza) e o original", () => {
    const s = montar(cenario());
    const det = lerAba(buildXlsx(s.abas), ABA_DETALHE_CONFLITOS).linhas;
    const col = (t: string) => TITULOS_COLUNAS_CONFLITOS.indexOf(t);
    const auto = det[1]!;
    const manual = det[2]!;
    expect(auto[col("Classificação")]).toBe("Duplicata em Sem Categoria");
    expect(auto[col("Código da classificação")]).toBe("duplicata_sem_categoria");
    expect(auto[col("Revisada manualmente")]).toBe("Não");
    expect(auto[col("Revisada por")]).toBe("");
    expect(manual[col("Revisada manualmente")]).toBe("Sim");
    expect(manual[col("Revisada por")]).toBe("Duda");
    expect(manual[col("Revisada em")]).toBe(serialHoraDeParede("2026-11-04T17:03:00Z")); // 20:03Z = 17:03 em Fortaleza (UTC-3), 04/11/2026
    expect(manual[col("Categoria original")]).toBe("Sem Categoria");
    expect(manual[col("Valor Cat. original")]).toBe("100.00");
    expect(manual[col("Chave da linha")]).toBe("Sem Categoria::Cliente Avulso");
    expect(manual[col("ID interno da linha")]).toBe("ln2");
  });

  it("mês e data de crédito vêm da segunda leitura; a data é data de verdade e a ausente fica em branco", () => {
    const s = montar(cenario());
    const det = lerAba(buildXlsx(s.abas), ABA_DETALHE_CONFLITOS).linhas;
    const col = (t: string) => TITULOS_COLUNAS_CONFLITOS.indexOf(t);
    expect(det[1]![col("Mês de crédito")]).toBe("2026-10");
    expect(det[1]![col("Data de crédito")]).toBe("46310"); // 2026-10-15
    expect(det[3]![col("Data de crédito")]).toBe("46315"); // 2026-10-20
    expect(det[7]![col("Mês de crédito")]).toBe("2026-10"); // fatura 1004
    expect(det[7]![col("Data de crédito")] ?? "").toBe(""); // sem data de crédito
    expect(det[8]![col("Mês de crédito")]).toBe("2026-09"); // a fatura 1001, em OUTRO mês
  });

  it("a mesma fatura em dois meses aparece como dois conflitos, com o mês de cada um", () => {
    const buf = buildXlsx(montar(cenario()).abas);
    const pf = lerAba(buf, "Por fatura").linhas;
    const da1001 = pf.slice(1, 6).filter((r) => r[0] === "1001");
    expect(da1001.map((r) => r[1]).sort()).toEqual(["2026-09", "2026-10"]);
  });

  it("'Por fatura': uma linha por conflito, com o total que fecha (Σ valor da fatura, Σ soma atual, Σ diferença)", () => {
    const buf = buildXlsx(montar(cenario()).abas);
    const pf = lerAba(buf, "Por fatura").linhas;
    expect(pf[0]).toEqual(["ID Fatura", "Mês de crédito", "Cliente", "Valor da fatura (uma parcela)", "Soma atual das linhas do mês", "Diferença (soma − fatura)", "Classificação", "Código da classificação", "Nº de linhas", "Explicação"]);
    expect(pf.slice(1, 6).map((r) => r[0])).toEqual(["1001", "1002", "1003", "1004", "1001"]);
    const total = pf[7]!;
    expect(total[0]).toBe("TOTAL");
    expect(total.slice(3, 6)).toEqual(["206.00", "337.50", "131.50"]);
    expect(total[8]).toBe("8");
    expect(pf[1]![9]).toContain("Salas Privativas - Seaway Center"); // a explicação do classificador, com a categoria
    // a soma da coluna Soma atual é a MESMA da aba principal
    expect(toAmountString(sum(pf.slice(1, 6).map((r) => r[4]!)))).toBe("337.50");
  });

  it("'Por classificação': faturas, linhas e soma de |diferença| por classificação, com total que fecha", () => {
    const buf = buildXlsx(montar(cenario()).abas);
    const pc = lerAba(buf, "Por classificação").linhas;
    expect(pc.slice(1, 4).map((r) => r.slice(0, 5))).toEqual([
      ["Duplicata em Sem Categoria", "duplicata_sem_categoria", "1", "2", "100.00"],
      ["Revisão manual superada", "manual_superada", "1", "2", "50.10"],
      ["Ambíguo (decisão manual)", "ambiguo", "3", "4", "18.60"],
    ]);
    expect(pc[5]!.slice(0, 5)).toEqual(["TOTAL", "", "5", "8", "168.70"]);
    expect(toAmountString(sum(pc.slice(1, 4).map((r) => r[4]!)))).toBe("168.70");
  });

  it("com filtro: só os conflitos pedidos, só essas classificações na aba de resumo e o Leia-me diz de quantos", () => {
    const c = cenario();
    const s = montar(c, { f: "1", resumos: "1", classificacao: "ambiguo" });
    expect(s.nConflitos).toBe(3);
    expect(s.nLinhas).toBe(4);
    expect(toAmountString(s.total)).toBe("37.30"); // 0,30 + 30,00 + 7,00
    const buf = buildXlsx(s.abas);
    const pc = lerAba(buf, "Por classificação").linhas;
    expect(pc.slice(1, 2).map((r) => r[1])).toEqual(["ambiguo"]);
    expect(pc[3]![0]).toBe("TOTAL"); // índices: 0 cabeçalho, 1 a única classificação, 2 linha em branco, 3 TOTAL
    const texto = textoDoLeiaMe(buf);
    expect(texto).toContain("3 de 5 em aberto (filtrado por classificação)");
    expect(texto).toMatch(/Classificação \| Ambíguo \(decisão manual\)/);
  });

  it("a ordem de chegada não muda a planilha (duas exportações iguais saem iguais)", () => {
    const c = cenario();
    const a = montar(c);
    const b = montar({ ...c, conflitos: [...c.conflitos].reverse() });
    expect(lerAba(buildXlsx(a.abas), "Conflitos").linhas).toEqual(lerAba(buildXlsx(b.abas), "Conflitos").linhas);
    expect(lerAba(buildXlsx(a.abas), "Por fatura").linhas).toEqual(lerAba(buildXlsx(b.abas), "Por fatura").linhas);
  });

  it("categorias saem com a grafia EXATA do banco (o espaço duplo de 'Sebrae' é real)", () => {
    const det = lerAba(buildXlsx(montar(cenario()).abas), "Conflitos").linhas;
    const iCat = TITULOS_COLUNAS_CONFLITOS.indexOf("Categoria da linha");
    expect(det.slice(1, 9).some((r) => r[iCat] === "Serviços de Espaço -  Sebrae")).toBe(true);
    expect(det.slice(1, 9).some((r) => r[iCat] === "Serviços de Espaço - Sebrae")).toBe(false);
  });
});

describe("aba Leia-me", () => {
  it("carrega o recorte, a hora (Fortaleza), quem gerou, a atualidade e o fechamento da conferência", () => {
    const texto = textoDoLeiaMe(buildXlsx(montar(cenario()).abas));
    expect(texto).toContain("Exportação de conflitos (possível dupla contagem)");
    expect(texto).toContain("Gerado em | 04/11/2026 17:00"); // 20:00Z
    expect(texto).toContain("Gerado por | Admin (a@t)");
    expect(texto).toMatch(/Classificação \| todas \(/);
    expect(texto).toContain("Receita sincronizando normalmente.");
    expect(texto).toContain("5 de 5 em aberto");
    expect(texto).toMatch(/Soma das linhas \(Valor Cat\.\) \| R\$\s337,50/); // \s: o formatBRL usa espaço não separável
    expect(texto).toMatch(/Excesso \(linhas somam mais que a fatura\) \| R\$\s150,10 em 2 conflito\(s\)/);
    expect(texto).toMatch(/Falta \(linhas somam menos que a fatura\) \| R\$\s18,60 em 3 conflito\(s\)/);
    expect(texto).toMatch(/Fechamento \| OK\. A soma de "Valor Cat\." \(R\$\s337,50\) é igual à soma das "soma atual" dos 5 conflito\(s\)/);
  });

  it("avisa que a lista é o ESTADO ATUAL do banco e que só Valor Cat. soma", () => {
    const texto = textoDoLeiaMe(buildXlsx(montar(cenario()).abas));
    expect(texto).toContain("ESTADO ATUAL do banco");
    expect(texto).toContain("não o retrato de uma rodada de sincronização");
    expect(texto).toContain('Some SOMENTE a coluna "Valor Cat."');
    expect(texto).toContain('A aba "Por fatura" tem uma linha por conflito.');
    expect(texto).toContain("o Conexa exporta uma parcela por cobrança");
    expect(texto).toContain("NEGATIVA: somam MENOS (falta de valor; não é dupla contagem)");
  });

  it("explica CADA classificação: o que significa e o que fazer", () => {
    const texto = textoDoLeiaMe(buildXlsx(montar(cenario()).abas));
    for (const t of CLASSIFICACOES) {
      expect(texto, t).toContain(`${INFO_CLASSIFICACAO[t].rotulo} — código "${t}". ${INFO_CLASSIFICACAO[t].significado} O que fazer: ${INFO_CLASSIFICACAO[t].acao}`);
    }
  });

  it("sem resumos o aviso não promete a aba 'Por fatura'", () => {
    const texto = textoDoLeiaMe(buildXlsx(montar(cenario(), { f: "1" }).abas));
    expect(texto).not.toContain('A aba "Por fatura"');
  });

  it("atualidade com problema vira ATENÇÃO; nome com caractere de controle não corrompe o arquivo", () => {
    const s = montar(cenario(), {}, { frescor: { texto: "A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA.", alerta: true }, usuario: { ...USUARIO, nome: "Ad\u0008min" } });
    const linhas = lerAba(buildXlsx(s.abas), "Leia-me").linhas;
    expect(linhas.find((r) => r[0] === "ATENÇÃO")?.[1]).toBe("A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA.");
    expect(linhas.find((r) => r[0] === "Gerado por")?.[1]).toBe("Admin (a@t)");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// O arquivo: leitura de volta (xlsx e csv) e texto hostil
// ---------------------------------------------------------------------------------------------------------------

describe("entregar: o arquivo escrito, lido de volta, fecha — e acusa defeito", () => {
  it("xlsx íntegro: entrega o arquivo e a leitura de volta confere a aba principal e os dois resumos", () => {
    const s = montar(cenario());
    const e = entregar(s.abas, s.esperado, "xlsx", ABA_DETALHE_CONFLITOS);
    expect(e.extensao).toBe("xlsx");
    expect(nomesDasAbas(e.buffer)).toEqual(["Conflitos", "Por fatura", "Por classificação", "Leia-me"]);
    expect(s.esperado.map((x) => x.nomeAba)).toEqual(["Conflitos", "Por fatura", "Por classificação"]);
    const lida = lerAba(e.buffer, "Conflitos").linhas;
    expect(conferirLeituraDeVolta(lida, { titulos: s.titulosDasColunas, nLinhas: 8, indiceValor: s.detalhe.indiceColunaTotal, total: "337.50" })).toEqual([]);
  });

  it("acusa número que virou texto na aba principal", () => {
    const s = montar(cenario());
    const aba = s.abas.find((a) => a.name === "Conflitos")!;
    aba.rows[1]![s.detalhe.indiceColunaTotal] = T("R$ 100,00");
    expect(() => entregar(s.abas, s.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(ExportacaoInconsistenteError);
    expect(() => entregar(s.abas, s.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(/Conflitos: .*não é número/);
  });

  it("acusa soma diferente, linha faltando e cabeçalho deslocado na aba principal", () => {
    const soma = montar(cenario());
    soma.abas.find((a) => a.name === "Conflitos")!.rows[1]![soma.detalhe.indiceColunaTotal] = BRL("100.01");
    expect(() => entregar(soma.abas, soma.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(/soma lida do arquivo/);

    const falta = montar(cenario());
    falta.abas.find((a) => a.name === "Conflitos")!.rows.splice(1, 1);
    expect(() => entregar(falta.abas, falta.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(ExportacaoInconsistenteError);

    const cab = montar(cenario());
    cab.abas.find((a) => a.name === "Conflitos")!.rows[0]!.splice(1, 1);
    expect(() => entregar(cab.abas, cab.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(/cabeçalho da coluna/);
  });

  it("acusa defeito também nos resumos (Por fatura e Por classificação)", () => {
    const pf = montar(cenario());
    pf.abas.find((a) => a.name === "Por fatura")!.rows[1]![4] = BRL("1.00");
    expect(() => entregar(pf.abas, pf.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(/Por fatura: soma lida do arquivo/);

    const pc = montar(cenario());
    pc.abas.find((a) => a.name === "Por classificação")!.rows[1]![4] = BRL("1.00");
    expect(() => entregar(pc.abas, pc.esperado, "xlsx", ABA_DETALHE_CONFLITOS)).toThrow(/Por classificação: soma lida do arquivo/);
  });

  it("csv íntegro: só a aba principal, vírgula decimal, datas dd/mm/aaaa, e a leitura de volta fecha", () => {
    const s = montar(cenario());
    const e = entregar(s.abas, s.esperado, "csv", ABA_DETALHE_CONFLITOS);
    expect(e.extensao).toBe("csv");
    expect(e.contentType).toContain("text/csv");
    const texto = e.buffer.toString("utf8");
    expect(texto.charCodeAt(0)).toBe(0xfeff); // BOM: sem ele o Excel abre os acentos errados
    const csv = lerCsv(texto);
    expect(csv).toHaveLength(9); // cabeçalho + 8 linhas, sem Leia-me, total nem resumos
    expect(csv[0]).toEqual(TITULOS_COLUNAS_CONFLITOS);
    const i = s.detalhe.indiceColunaTotal;
    expect(csv[1]![i]).toBe("100,00");
    expect(toAmountString(sum(csv.slice(1).map((r) => r[i]!.replace(",", "."))))).toBe("337.50");
    expect(csv[1]![TITULOS_COLUNAS_CONFLITOS.indexOf("Data de crédito")]).toBe("15/10/2026");
    expect(csv[2]![TITULOS_COLUNAS_CONFLITOS.indexOf("Revisada em")]).toBe("04/11/2026 17:03");
  });

  it("csv: acusa número que virou texto", () => {
    const s = montar(cenario());
    s.abas.find((a) => a.name === "Conflitos")!.rows[1]![s.detalhe.indiceColunaTotal] = T("R$ 100,00");
    expect(() => entregar(s.abas, s.esperado, "csv", ABA_DETALHE_CONFLITOS)).toThrow(/Conferência de leitura do CSV não fechou/);
  });
});

describe("texto hostil vindo do banco", () => {
  it("xlsx: fórmula vira texto, controle de XML sai, marcação é escapada e o arquivo continua íntegro", () => {
    const s = montar(cenario());
    const e = entregar(s.abas, s.esperado, "xlsx", ABA_DETALHE_CONFLITOS);
    const det = lerAba(e.buffer, "Conflitos").linhas;
    const col = (t: string) => TITULOS_COLUNAS_CONFLITOS.indexOf(t);
    const hostil = det[7]!;
    expect(hostil[col("Cliente")]).toBe('=HYPERLINK("http://evil.example","x")'); // controle \u0008 removido, o resto intacto
    expect(hostil[col("Categoria da linha")]).toBe("Categoria"); // \u0001 removido
    expect(hostil[col("Serviço/Plano")]).toBe("+cmd|' /C calc'!A0");
    expect(hostil[col("Chave da linha")]).toBe("k-"); // \u000b removido
    expect(det[1]![col("Cliente")]).toBe("Cliente & Filhos <Ltda>"); // & e < escapados no XML e relidos intactos
    // texto é string inline, nunca fórmula: a única <f> da aba é o SUBTOTAL do rodapé
    const xml = lerXml(e.buffer, "xl/worksheets/sheet1.xml");
    expect([...xml.matchAll(/<f>([^<]*)<\/f>/g)].map((m) => m[1]!)).toEqual([expect.stringMatching(/^SUBTOTAL\(109,L2:L9\)$/)]);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("csv: texto que começa com = + - @ ganha apóstrofo (injeção de fórmula) e o arquivo relido tem as 8 linhas", () => {
    const s = montar(cenario());
    const e = entregar(s.abas, s.esperado, "csv", ABA_DETALHE_CONFLITOS);
    const csv = lerCsv(e.buffer.toString("utf8"));
    const col = (t: string) => TITULOS_COLUNAS_CONFLITOS.indexOf(t);
    const hostil = csv[7]!;
    expect(hostil[col("Cliente")]).toBe(`'=HYPERLINK("http://evil.example","x")`);
    expect(hostil[col("Serviço/Plano")]).toBe("'+cmd|' /C calc'!A0");
    expect(csv).toHaveLength(9);
    expect(new Set(csv.map((r) => r.length)).size).toBe(1); // toda linha com a largura do cabeçalho
  });
});

describe("sem nenhum conflito (o melhor resultado)", () => {
  const vazio = (params: Record<string, string> = {}) => {
    const pedido = lerPedidoConflitos(comResumos(params)).pedido;
    return montarAbasConflitos({ conflitos: [], totalSemFiltro: 0, pedido, geradoEm: GERADO_EM, usuario: USUARIO, frescor: FRESCOR });
  };

  it("monta e entrega xlsx e csv só com cabeçalhos e totais zerados (serve de comprovante)", () => {
    const s = vazio();
    expect(s.nLinhas).toBe(0);
    expect(s.detalhe.total).toBe("0.00");
    const x = entregar(s.abas, s.esperado, "xlsx", ABA_DETALHE_CONFLITOS);
    expect(nomesDasAbas(x.buffer)).toEqual(["Conflitos", "Por fatura", "Por classificação", "Leia-me"]);
    const csv = lerCsv(entregar(vazio().abas, vazio().esperado, "csv", ABA_DETALHE_CONFLITOS).buffer.toString("utf8"));
    expect(csv).toEqual([TITULOS_COLUNAS_CONFLITOS]);
  });

  it("o Leia-me diz que não há conflito e a aba Por classificação traz as três classificações com zero", () => {
    const buf = buildXlsx(vazio().abas);
    expect(textoDoLeiaMe(buf)).toContain("0 de 0 em aberto");
    const pc = lerAba(buf, "Por classificação").linhas;
    expect(pc.slice(1, 4).map((r) => [r[1], r[2], r[3], r[4]])).toEqual([
      ["duplicata_sem_categoria", "0", "0", "0.00"],
      ["manual_superada", "0", "0", "0.00"],
      ["ambiguo", "0", "0", "0.00"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Catálogo de colunas
// ---------------------------------------------------------------------------------------------------------------

describe("catálogo de colunas", () => {
  const completa: LinhaDoDetalhe = {
    crConexaId: 1,
    mesCredito: "2026-10",
    dataCredito: dia("2026-10-15"),
    cliente: "C",
    valorFatura: "1.00",
    somaAtual: "2.00",
    diferenca: "1.00",
    classificacao: "ambiguo",
    categoria: "Cat",
    servicoOuPlano: "S",
    valorCat: "1.00",
    revisadoManualmente: true,
    revisadoPor: "Duda",
    revisadoEm: dia("2026-11-04"),
    categoriaOriginal: "CO",
    valorCatOriginal: "0.50",
    chaveLinha: "k",
    idLinha: "id",
  };

  /** Proxy que registra cada propriedade lida (a mesma prova do catálogo da receita). */
  function lidos(coluna: (typeof COLUNAS_CONFLITOS)[number]): string[] {
    const visto = new Set<string>();
    const p = new Proxy(completa, {
      get(alvo, prop) {
        visto.add(String(prop));
        return (alvo as unknown as Record<string, unknown>)[String(prop)];
      },
    });
    coluna.valor(p);
    return [...visto].sort();
  }

  it.each(COLUNAS_CONFLITOS.map((c) => [c.id, c] as const))("coluna %s lê só os campos que declara — e todos eles", (_id, coluna) => {
    expect(lidos(coluna)).toEqual([...coluna.campos].sort());
  });

  it("todo campo declarado existe em LinhaDoDetalhe; ids e títulos são únicos", () => {
    for (const c of COLUNAS_CONFLITOS) for (const f of c.campos) expect(Object.keys(completa), `${c.id} → ${f}`).toContain(f);
    expect(new Set(COLUNAS_CONFLITOS.map((c) => c.id)).size).toBe(COLUNAS_CONFLITOS.length);
    expect(new Set(TITULOS_COLUNAS_CONFLITOS).size).toBe(TITULOS_COLUNAS_CONFLITOS.length);
  });

  it("as colunas pedidas existem, na ordem, e só Valor Cat. é a coluna que soma", () => {
    expect(TITULOS_COLUNAS_CONFLITOS.map((t) => t.replace(/ — do conflito, NÃO somar$/, ""))).toEqual([
      "ID Fatura",
      "Mês de crédito",
      "Data de crédito",
      "Cliente",
      "Valor da fatura (uma parcela)",
      "Soma atual das linhas do mês",
      "Diferença (soma − fatura)",
      "Classificação",
      "Código da classificação",
      "Categoria da linha",
      "Serviço/Plano",
      "Valor Cat.",
      "Revisada manualmente",
      "Revisada por",
      "Revisada em",
      "Categoria original",
      "Valor Cat. original",
      "Chave da linha",
      "ID interno da linha",
    ]);
    const total = COLUNAS_CONFLITOS.find((c) => c.id === COLUNA_VALOR_CONFLITOS)!;
    expect(total.titulo).toBe("Valor Cat.");
    expect(total.tipo).toBe("dinheiro");
  });

  it("dinheiro entra como string decimal exata (nunca number) em todas as colunas de dinheiro", () => {
    for (const c of COLUNAS_CONFLITOS.filter((x) => x.tipo === "dinheiro")) expect(typeof c.valor(completa), c.id).toBe("string");
  });
});
