import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx/writer";
import { lerAba, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { money, sum, toAmountString } from "@/lib/money";
import type { LinhaReceita } from "@/lib/exportacao/colunas-receita";
import { COLUNAS_RECEITA, colunasDosGrupos, grupoPermitido, temDadosPessoais } from "@/lib/exportacao/colunas-receita";
import { lerFiltrosReceita } from "@/lib/exportacao/filtros-receita";
import { montarAbasReceita, type EntradaPasta } from "@/lib/exportacao/pasta-receita";
import { conferirContraBanco, conferirLeituraDeVolta } from "@/lib/exportacao/conferencia";
import { celulaDe, paraParede } from "@/lib/exportacao/planilha";
import { textoSeguro, LIMITE_CELULA } from "@/lib/exportacao/texto";

/**
 * Hoje as abas de RESUMO vêm DESLIGADAS por padrão (a planilha é para os dados; o painel já resume). Estes testes exercitam os
 * resumos, então pedem explicitamente — a menos que o próprio teste mande `f` (formulário enviado), caso em que vale o que ele mandou.
 */
const comResumos = (params: Record<string, string | string[]>): Record<string, string | string[]> => ("f" in params ? params : { resumos: "1", ...params });

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let seq = 0;
function linha(p: Partial<LinhaReceita> & Pick<LinhaReceita, "crConexaId" | "categoria" | "valorRecebidoCat" | "mesCredito">): LinhaReceita {
  seq += 1;
  return {
    id: `id${seq}`,
    chaveLinha: `k${seq}`,
    unidade: "SEAHUB COWORKING",
    faturamento: "Mensal",
    clienteConexaId: 500,
    cpfCnpj: "12.345.678/0001-90",
    razaoSocial: "Cliente & Filhos <Ltda>",
    planoContratado: "Plano X",
    servicoOuPlano: "Serviço X",
    proporcionado: "N",
    tipo: "Recorrente",
    status: "Quitada",
    parcela: "1/12",
    valorRecebidoTotal: "1000.00",
    valorBruto: "1200.00",
    valorDesconto: "200.00",
    vencimento: dia("2026-09-10"),
    quitacao: dia("2026-09-12"),
    competencia: dia("2026-09-01"),
    emissao: null,
    dataCredito: dia(`${p.mesCredito}-15`),
    conta: "Conta A",
    observacoes: null,
    tags: null,
    ajusteArredondamento: null,
    revisadoManualmente: false,
    revisadoPorNome: null,
    revisadoEm: null,
    categoriaOriginal: null,
    valorRecebidoCatOriginal: null,
    atualizadoEm: dia("2026-11-04"),
    itensDetalhe: null,
    ...p,
  };
}

/** Duas faturas rateadas (mesma fatura em duas categorias), um SEM_LV, uma revisada, conta/unidade vazias, dois meses. */
const LINHAS: LinhaReceita[] = [
  linha({ crConexaId: 1, categoria: "Endereço Fiscal", valorRecebidoCat: "100.00", mesCredito: "2026-09" }),
  linha({ crConexaId: 2, categoria: "Salas Privativas - Seaway Center", valorRecebidoCat: "600.10", mesCredito: "2026-09", proporcionado: "S" }),
  linha({ crConexaId: 2, categoria: "Outros Serviços", valorRecebidoCat: "399.90", mesCredito: "2026-09", proporcionado: "S", chaveLinha: "k-b" }),
  linha({ crConexaId: 3, categoria: "Endereço Fiscal", valorRecebidoCat: "100.00", mesCredito: "2026-10", conta: null, unidade: null }),
  linha({ crConexaId: 4, categoria: "Sem Categoria", valorRecebidoCat: "33.33", mesCredito: "2026-10", proporcionado: "SEM_LV", status: "Quitada (Gerada por Negociação)" }),
  linha({
    crConexaId: 5,
    categoria: "Outros Serviços",
    valorRecebidoCat: "49.99",
    mesCredito: "2026-10",
    revisadoManualmente: true,
    revisadoPorNome: "Duda",
    categoriaOriginal: "Endereço Fiscal",
    valorRecebidoCatOriginal: "50.00",
    observacoes: "texto com & e <tags> e \u0008 controle",
  }),
];
const TOTAL_ESPERADO = "1283.32"; // 100 + 600.10 + 399.90 + 100 + 33.33 + 49.99

const base: Omit<EntradaPasta, "filtros"> = {
  linhas: LINHAS,
  geradoEm: new Date("2026-11-04T20:00:00Z"),
  usuario: { id: "u1", nome: "Admin de Teste", email: "admin@teste.local", papel: "ADMIN" },
  frescor: { texto: "Receita sincronizando normalmente.", alerta: false },
  semDataCreditoNoBanco: 0,
  hoje: "2026-11-04",
};

const entrada = (params: Record<string, string | string[]>): EntradaPasta => ({ ...base, filtros: lerFiltrosReceita(comResumos(params)).filtros });

describe("montarAbasReceita", () => {
  it("abas na ordem: Cobranças (os dados) primeiro, os resumos (só se pedidos) e o Leia-me por ÚLTIMO; 'Por mês' e 'Categoria x mês' só quando há mais de um mês", () => {
    const multi = montarAbasReceita(entrada({ f: "1", grupos: "fatura", resumos: "1" }));
    expect(multi.abas.map((a) => a.name)).toEqual([
      "Cobranças", "Por categoria", "Por conta", "Por unidade", "Por situação", "Rateio", "Por mês", "Por dia", "Categoria x mês", "Leia-me",
    ]);

    const umMes = montarAbasReceita({ ...entrada({ f: "1", resumos: "1" }), linhas: LINHAS.filter((l) => l.mesCredito === "2026-09") });
    expect(umMes.abas.map((a) => a.name)).not.toContain("Por mês");
    expect(umMes.abas.map((a) => a.name)).not.toContain("Categoria x mês");

    const semResumos = montarAbasReceita(entrada({ f: "1", grupos: "fatura" }));
    expect(semResumos.abas.map((a) => a.name)).toEqual(["Cobranças", "Leia-me"]);
  });

  it("o total do detalhe é a soma EXATA de valorRecebidoCat (decimal, sem float)", () => {
    const s = montarAbasReceita(entrada({ f: "1", resumos: "1" }));
    expect(toAmountString(s.total)).toBe(TOTAL_ESPERADO);
    expect(s.detalhe.total).toBe(TOTAL_ESPERADO);
    // 0,1 + 0,2 em float daria 0.30000000000000004 — aqui nunca
    expect(toAmountString(sum(["0.1", "0.2"]))).toBe("0.30");
  });

  it("todo resumo fecha com o total do detalhe (a mesma soma, centavo a centavo)", () => {
    const s = montarAbasReceita(entrada({ f: "1", resumos: "1" }));
    const buf = buildXlsx(s.abas);
    for (const nome of ["Por categoria", "Por conta", "Por unidade", "Por situação", "Rateio", "Por mês", "Por dia"]) {
      const linhas = lerAba(buf, nome).linhas;
      const total = linhas.find((r) => r[0] === "TOTAL")!;
      expect(total[3], nome).toBe(TOTAL_ESPERADO);
      const dados = linhas.slice(1).filter((r) => r.length && r[0] !== "TOTAL" && r[3] !== undefined && r[3] !== "");
      expect(toAmountString(sum(dados.map((r) => r[3]!))), nome).toBe(TOTAL_ESPERADO);
    }
  });

  it("'Por categoria' ordena por valor, conta faturas DISTINTAS e o total de faturas não é a soma dos grupos", () => {
    const s = montarAbasReceita(entrada({ f: "1", resumos: "1" }));
    const linhas = lerAba(buildXlsx(s.abas), "Por categoria").linhas;
    const dados = linhas.slice(1).filter((r) => r[0] && r[0] !== "TOTAL" && r[1]);
    expect(dados.map((r) => r[0])).toEqual([
      "Salas Privativas - Seaway Center", // 600,10
      "Outros Serviços", // 399,90 + 49,99
      "Endereço Fiscal", // 200,00
      "Sem Categoria", // 33,33
    ]);
    const outros = dados.find((r) => r[0] === "Outros Serviços")!;
    expect(outros[1]).toBe("2"); // 2 linhas
    expect(outros[2]).toBe("2"); // faturas 2 e 5
    const total = linhas.find((r) => r[0] === "TOTAL")!;
    expect(total[1]).toBe("6"); // 6 linhas
    expect(total[2]).toBe("5"); // 5 faturas distintas: a fatura 2 está em 2 categorias e conta uma vez
    const somaFaturasPorGrupo = dados.reduce((a, r) => a + Number(r[2]), 0);
    expect(somaFaturasPorGrupo).toBe(6); // ≠ 5: justamente por isso a coluna não soma
  });

  it("conta/unidade/situação vazias aparecem com rótulo legível", () => {
    const buf = buildXlsx(montarAbasReceita(entrada({ f: "1", resumos: "1" })).abas);
    expect(lerAba(buf, "Por conta").linhas.map((r) => r[0])).toContain("(sem conta informada)");
    expect(lerAba(buf, "Por unidade").linhas.map((r) => r[0])).toContain("(sem unidade)");
  });

  it("'Categoria x mês' é uma matriz que soma por linha, por coluna e no total geral", () => {
    const buf = buildXlsx(montarAbasReceita(entrada({ f: "1", resumos: "1" })).abas);
    const m = lerAba(buf, "Categoria x mês").linhas;
    expect(m[0]).toEqual(["Categoria", "2026-09", "2026-10", "Total"]);
    const fiscal = m.find((r) => r[0] === "Endereço Fiscal")!;
    expect(fiscal.slice(1)).toEqual(["100.00", "100.00", "200.00"]);
    expect(m.find((r) => r[0] === "TOTAL")!.slice(1)).toEqual(["1100.00", "183.32", TOTAL_ESPERADO]);
  });

  it("a aba Leia-me carrega recorte, hora, quem gerou, atualidade e os avisos que valem para ESTE arquivo", () => {
    const s = montarAbasReceita(entrada({ f: "1", mes: "2026-10", grupos: "fatura", resumos: "1" }));
    const texto = lerAba(buildXlsx(s.abas), "Leia-me").linhas.map((r) => r.join(" | ")).join("\n");
    expect(texto).toContain("Período (Data de Crédito) | 01/10/2026 a 31/10/2026");
    expect(texto).toContain("Gerado por | Admin de Teste (admin@teste.local)");
    expect(texto).toContain("04/11/2026 17:00"); // 20:00Z = 17:00 em Fortaleza
    expect(texto).toContain("Receita sincronizando normalmente.");
    expect(texto).toContain("Some SOMENTE a coluna 'Valor Recebido Cat.'");
    expect(texto).not.toContain("em andamento"); // outubro já fechou (hoje é 04/11)
    expect(texto).toMatch(/1 linha\(s\) estão em "Sem Categoria" \(R\$\s33,33\)/); // \s: o formatBRL usa espaço não separável
    expect(texto).toContain("1 linha(s) foram revisadas manualmente");
    expect(texto).toContain("Conferência");
  });

  it("o aviso dos valores da fatura só aparece quando as colunas da fatura estão no arquivo", () => {
    const sem = lerAba(buildXlsx(montarAbasReceita(entrada({ f: "1", resumos: "1" })).abas), "Leia-me").linhas.flat().join(" ");
    expect(sem).not.toContain("Some SOMENTE");
  });

  it("período que alcança hoje (ou sem limite de data) avisa que o total muda a cada sincronização", () => {
    const leia = (p: Record<string, string>) => lerAba(buildXlsx(montarAbasReceita(entrada({ f: "1", resumos: "1", ...p })).abas), "Leia-me").linhas.flat().join(" ");
    expect(leia({ de: "2026-10-15", ate: "2026-11-30" })).toContain("em andamento");
    expect(leia({})).toContain("em andamento"); // todos os meses: o mês corrente está dentro
    expect(leia({ de: "2026-11-05" })).not.toContain("em andamento"); // só o futuro
    expect(leia({ ate: "2026-11-03" })).not.toContain("em andamento"); // só o passado
  });

  it("mês fechado não diz 'em andamento'; atualidade com problema vira ATENÇÃO", () => {
    const fechado = montarAbasReceita({ ...entrada({ f: "1", mes: "2026-09", resumos: "1" }), linhas: LINHAS.filter((l) => l.mesCredito === "2026-09") });
    expect(lerAba(buildXlsx(fechado.abas), "Leia-me").linhas.flat().join(" ")).not.toContain("em andamento");
    const alerta = montarAbasReceita({ ...entrada({ f: "1", resumos: "1" }), frescor: { texto: "A sincronização está PARADA há 3 h.", alerta: true } });
    const linhas = lerAba(buildXlsx(alerta.abas), "Leia-me").linhas;
    expect(linhas.find((r) => r[0] === "ATENÇÃO")?.[1]).toBe("A sincronização está PARADA há 3 h.");
  });

  it("datas viram datas de verdade e dinheiro vira número no detalhe", () => {
    const s = montarAbasReceita(entrada({ f: "1", grupos: "fatura" }));
    const buf = buildXlsx(s.abas);
    const det = lerAba(buf, "Cobranças").linhas;
    const iCred = s.titulosDasColunas.indexOf("Data Crédito");
    const iValor = s.titulosDasColunas.indexOf("Valor Recebido Cat.");
    expect(det[1]![iCred]).toBe("46280"); // 2026-09-15
    expect(det[1]![iValor]).toBe("100.00");
    expect(det[0]).toEqual(s.titulosDasColunas);
  });

  it("os valores da fatura têm no título o aviso de NÃO somar", () => {
    const titulos = colunasDosGrupos(["fatura"]).map((c) => c.titulo);
    expect(titulos.filter((t) => t.includes("NÃO somar"))).toHaveLength(3);
  });

  it("texto livre perigoso não corrompe o arquivo (caractere de controle removido, markup escapado)", () => {
    const s = montarAbasReceita(entrada({ f: "1", grupos: ["sensiveis"], resumos: "" }));
    const buf = buildXlsx(s.abas);
    const det = lerAba(buf, "Cobranças").linhas;
    const iObs = s.titulosDasColunas.indexOf("Observações");
    expect(det.some((r) => r[iObs] === "texto com & e <tags> e  controle")).toBe(true);
  });
});

describe("colunas e permissões", () => {
  it("os ids de coluna são únicos e cada grupo existe", () => {
    const ids = COLUNAS_RECEITA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COLUNAS_RECEITA) expect(["essenciais", "fatura", "auditoria", "sensiveis"]).toContain(c.grupo);
  });

  it("dados pessoais (CPF/CNPJ e texto livre) estão SOMENTE no grupo de administrador", () => {
    const sensiveis = COLUNAS_RECEITA.filter((c) => c.grupo === "sensiveis").map((c) => c.titulo);
    expect(sensiveis.sort()).toEqual(["CPF/CNPJ", "Observações"]);
    const semSensiveis = colunasDosGrupos(["fatura", "auditoria"]).map((c) => c.titulo);
    expect(semSensiveis).not.toContain("CPF/CNPJ");
    expect(semSensiveis).not.toContain("Observações");
  });

  it("papel: visualizador não pede o grupo sensível; administrador pede", () => {
    expect(grupoPermitido("sensiveis", "VIEWER")).toBe(false);
    expect(grupoPermitido("sensiveis", "ADMIN")).toBe(true);
    expect(grupoPermitido("fatura", "VIEWER")).toBe(true);
    expect(grupoPermitido("inventado", "ADMIN")).toBe(false);
    expect(temDadosPessoais(["fatura"])).toBe(false);
    expect(temDadosPessoais(["fatura", "sensiveis"])).toBe(true);
  });

  it("a ordem das colunas é a do catálogo, qualquer que seja a ordem em que os grupos foram escolhidos", () => {
    const a = colunasDosGrupos(["auditoria", "fatura"]).map((c) => c.id);
    const b = colunasDosGrupos(["fatura", "auditoria"]).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe("idFatura");
  });
});

describe("conferirContraBanco (prova que a conferência ACUSA defeito)", () => {
  const ref = {
    contagem: LINHAS.length,
    total: TOTAL_ESPERADO,
    porCategoria: new Map([
      ["Endereço Fiscal", "200.00"],
      ["Salas Privativas - Seaway Center", "600.10"],
      ["Outros Serviços", "449.89"],
      ["Sem Categoria", "33.33"],
    ]),
  };

  it("dado íntegro: nenhuma divergência", () => {
    expect(conferirContraBanco(LINHAS, ref)).toEqual([]);
  });

  it("acusa leitura truncada (uma linha a menos)", () => {
    const p = conferirContraBanco(LINHAS.slice(1), ref);
    expect(p.some((x) => x.includes("contagem do banco"))).toBe(true);
    expect(p.some((x) => x.includes("soma do banco"))).toBe(true);
  });

  it("acusa um centavo de diferença numa categoria", () => {
    const adulterada = LINHAS.map((l) => (l.crConexaId === 4 ? { ...l, valorRecebidoCat: "33.34" } : l));
    const p = conferirContraBanco(adulterada, ref);
    expect(p.some((x) => x.includes('categoria "Sem Categoria"'))).toBe(true);
  });

  it("acusa categoria que existe só de um lado", () => {
    const p = conferirContraBanco(LINHAS, { ...ref, porCategoria: new Map([...ref.porCategoria, ["Fantasma", "1.00"]]) });
    expect(p.some((x) => x.includes('categoria "Fantasma"'))).toBe(true);
  });
});

describe("conferirLeituraDeVolta (prova que a conferência ACUSA defeito do arquivo)", () => {
  const s = montarAbasReceita(entrada({ f: "1", resumos: "" }));
  const buf = buildXlsx(s.abas);
  const esperado = { titulos: s.titulosDasColunas, nLinhas: LINHAS.length, indiceValor: s.detalhe.indiceColunaTotal, total: TOTAL_ESPERADO };

  it("arquivo íntegro: nenhuma divergência", () => {
    expect(conferirLeituraDeVolta(lerAba(buf, "Cobranças").linhas, esperado)).toEqual([]);
  });

  it("acusa número que virou texto", () => {
    const linhas = lerAba(buf, "Cobranças").linhas.map((r) => [...r]);
    linhas[2]![esperado.indiceValor] = "R$ 600,10";
    expect(conferirLeituraDeVolta(linhas, esperado).some((x) => x.includes("não é número"))).toBe(true);
  });

  it("acusa soma diferente, linha faltando e rodapé errado", () => {
    const base = lerAba(buf, "Cobranças").linhas.map((r) => [...r]);
    const somaErrada = base.map((r) => [...r]);
    somaErrada[1]![esperado.indiceValor] = "100.01";
    expect(conferirLeituraDeVolta(somaErrada, esperado).some((x) => x.includes("soma lida do arquivo"))).toBe(true);
    expect(conferirLeituraDeVolta(base.slice(0, 3), esperado).some((x) => x.includes("linha(s) de dados"))).toBe(true);
    const rodapeErrado = base.map((r) => [...r]);
    rodapeErrado[esperado.nLinhas + 2]![esperado.indiceValor] = "1.00";
    expect(conferirLeituraDeVolta(rodapeErrado, esperado).some((x) => x.includes("rodapé TOTAL"))).toBe(true);
  });

  it("acusa cabeçalho deslocado", () => {
    const linhas = lerAba(buf, "Cobranças").linhas.map((r) => [...r]);
    linhas[0]!.splice(1, 1);
    expect(conferirLeituraDeVolta(linhas, esperado).some((x) => x.includes("cabeçalho da coluna"))).toBe(true);
  });
});

describe("texto e células", () => {
  it("remove caracteres de controle e substitutos soltos, mantém acento, quebra de linha e tab", () => {
    expect(textoSeguro("a\u0008b\u000bc\u0001d")).toBe("abcd");
    expect(textoSeguro("ação\ncoração\tç")).toBe("ação\ncoração\tç");
    expect(textoSeguro("x\uD800y")).toBe("xy");
    expect(textoSeguro("😀 ok")).toBe("😀 ok");
    expect(textoSeguro(null)).toBe("");
  });

  it("corta, de forma marcada, o texto que passaria do limite da célula do Excel", () => {
    const t = textoSeguro("x".repeat(LIMITE_CELULA + 500));
    expect(t.length).toBeLessThanOrEqual(LIMITE_CELULA);
    expect(t).toContain("texto cortado");
  });

  it("célula: id sem formato, texto nunca vira número, vazio vira célula vazia", () => {
    expect(celulaDe("id", 29113)).toMatchObject({ kind: "num", num: "29113", style: 0 });
    expect(celulaDe("texto", "007")).toMatchObject({ kind: "text", text: "007" });
    expect(celulaDe("texto", "=1+1")).toMatchObject({ kind: "text", text: "=1+1" }); // string inline: nunca fórmula
    expect(celulaDe("dinheiro", null)).toMatchObject({ kind: "blank" });
    expect(celulaDe("dinheiro", "10.5")).toMatchObject({ kind: "num", num: "10.5" });
  });

  it("relógio de parede: 20:03Z é 17:03 em Fortaleza (UTC-3)", () => {
    expect(paraParede(new Date("2026-11-04T20:03:00.000Z")).toISOString()).toBe("2026-11-04T17:03:00.000Z");
    expect(paraParede(new Date("2026-11-05T01:00:00.000Z")).toISOString()).toBe("2026-11-04T22:00:00.000Z"); // atravessa o dia
  });

  it("nomesDasAbas lê o que o gerador escreveu", () => {
    expect(nomesDasAbas(buildXlsx(montarAbasReceita(entrada({ f: "1" })).abas))).toEqual(["Cobranças", "Leia-me"]);
  });

  it("dinheiro em decimal: 0,1 + 0,2 + … nunca vira 0,30000000000000004", () => {
    expect(toAmountString(money("0.1").plus(money("0.2")))).toBe("0.30");
  });
});
