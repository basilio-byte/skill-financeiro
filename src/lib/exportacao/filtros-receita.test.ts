import { describe, expect, it } from "vitest";
import {
  VAZIO,
  dataReal,
  descreverFiltros,
  filtrosParaWhere,
  lerFiltrosReceita,
  mesReal,
  nomeDoArquivoReceita,
  periodoEfetivo,
} from "@/lib/exportacao/filtros-receita";

const ler = (p: Record<string, string | string[] | undefined>) => lerFiltrosReceita(p);

describe("datas e meses", () => {
  it("aceita só data que existe no calendário (fevereiro não vira março em silêncio)", () => {
    expect(dataReal("2026-10-31")).toBe(true);
    expect(dataReal("2028-02-29")).toBe(true);
    expect(dataReal("2026-02-29")).toBe(false);
    expect(dataReal("2026-02-31")).toBe(false);
    expect(dataReal("2026-13-01")).toBe(false);
    expect(dataReal("26-10-31")).toBe(false);
    expect(dataReal("1999-12-31")).toBe(false);
    expect(dataReal("2026-10-31T00:00")).toBe(false);
  });

  it("mês no formato aaaa-mm", () => {
    expect(mesReal("2026-10")).toBe(true);
    expect(mesReal("2026-13")).toBe(false);
    expect(mesReal("2026-1")).toBe(false);
    expect(mesReal("outubro")).toBe(false);
  });

  it("o mês vira o intervalo do primeiro ao último dia (inclusive fevereiro bissexto)", () => {
    expect(periodoEfetivo({ mes: "2026-10", de: null, ate: null })).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(periodoEfetivo({ mes: "2026-09", de: null, ate: null })).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
    expect(periodoEfetivo({ mes: "2028-02", de: null, ate: null })).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
    expect(periodoEfetivo({ mes: "2026-02", de: null, ate: null })).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
  });

  it("datas explícitas vencem o mês; sem nada, não há limite de data", () => {
    expect(periodoEfetivo({ mes: "2026-10", de: "2026-10-05", ate: null })).toEqual({ de: "2026-10-05", ate: null });
    expect(periodoEfetivo({ mes: null, de: null, ate: null })).toEqual({ de: null, ate: null });
  });
});

describe("lerFiltrosReceita", () => {
  it("sem parâmetros: padrões (grupo 'fatura', SEM resumos, sem itens) e nenhum erro", () => {
    const { filtros, erros } = ler({});
    expect(erros).toEqual([]);
    expect(filtros.grupos).toEqual(["fatura"]);
    expect(filtros.resumos).toBe(false); // a planilha é para os dados; o painel já resume
    expect(filtros.itens).toBe(false);
    expect(filtros.categorias).toEqual([]);
  });

  it("f=1 (formulário enviado): caixa ausente = desmarcada", () => {
    const { filtros } = ler({ f: "1" });
    expect(filtros.grupos).toEqual([]);
    expect(filtros.resumos).toBe(false);
    expect(filtros.itens).toBe(false);
    const marcado = ler({ f: "1", grupos: ["fatura", "auditoria"], resumos: "1", itens: "1" }).filtros;
    expect(marcado.grupos).toEqual(["fatura", "auditoria"]);
    expect(marcado.resumos).toBe(true);
    expect(marcado.itens).toBe(true);
  });

  it("valor malformado vira ERRO, nunca filtro ignorado em silêncio", () => {
    expect(ler({ mes: "2026-1" }).erros[0]).toMatch(/Mês inválido/);
    expect(ler({ de: "31/10/2026" }).erros[0]).toMatch(/Data inicial inválida/);
    expect(ler({ ate: "2026-02-31" }).erros[0]).toMatch(/Data final inválida/);
    expect(ler({ de: "2026-10-31", ate: "2026-10-01" }).erros).toContain("A data inicial é depois da data final.");
    expect(ler({ proporcionado: "X" }).erros[0]).toMatch(/rateio desconhecido/);
    expect(ler({ revisada: "talvez" }).erros[0]).toMatch(/Revisão manual/);
    expect(ler({ cliente: "a" }).erros[0]).toMatch(/ao menos 2/);
    expect(ler({ servico: "a" }).erros[0]).toMatch(/ao menos 2/);
    expect(ler({ fatura: "12a" }).erros[0]).toMatch(/ID da fatura inválido/);
    expect(ler({ fatura: "99999999999" }).erros[0]).toMatch(/ID da fatura inválido/);
    expect(ler({ grupos: "inexistente" }).erros[0]).toMatch(/Grupo de colunas desconhecido/);
  });

  it("valores com vírgula ou milhar são recusados (ambiguidade pt-BR: '25.000' viraria 25 reais)", () => {
    expect(ler({ valorMin: "25,50" }).erros[0]).toMatch(/PONTO decimal/);
    expect(ler({ valorMin: "25.000,00" }).erros[0]).toMatch(/PONTO decimal/);
    expect(ler({ valorMax: "R$ 10" }).erros[0]).toMatch(/PONTO decimal/);
    expect(ler({ valorMin: "25.5", valorMax: "30" }).erros).toEqual([]);
    expect(ler({ valorMin: "30", valorMax: "25.5" }).erros).toContain("O valor mínimo é maior que o valor máximo.");
  });

  it("listas: aparam, tiram duplicados e vazios, e têm teto", () => {
    const f = ler({ categoria: [" A ", "A", "", "B"], conta: "C1" }).filtros;
    expect(f.categorias).toEqual(["A", "B"]);
    expect(f.contas).toEqual(["C1"]);
    const muitas = Array.from({ length: 100 }, (_, i) => `cat${i}`);
    expect(ler({ categoria: muitas }).filtros.categorias).toHaveLength(60);
  });

  it("repete o espaçamento exato das categorias (duas espaços de 'Sebrae' são reais e não podem ser normalizados)", () => {
    const f = ler({ categoria: "Salas Privativas -  Sebrae" }).filtros;
    expect(f.categorias).toEqual(["Salas Privativas -  Sebrae"]);
  });
});

describe("filtrosParaWhere", () => {
  it("sem filtro nenhum: todas as linhas", () => {
    expect(filtrosParaWhere(ler({}).filtros)).toEqual({});
  });

  it("o mês filtra por Data de Crédito (a mesma regra do Panorama), inclusive nas duas pontas", () => {
    const w = filtrosParaWhere(ler({ mes: "2026-10" }).filtros);
    expect(w).toEqual({
      AND: [{ dataCredito: { gte: new Date("2026-10-01T00:00:00.000Z"), lte: new Date("2026-10-31T00:00:00.000Z") } }],
    });
  });

  it("conta/unidade vazias entram por OR com null", () => {
    const w = filtrosParaWhere(ler({ conta: ["Cielo", VAZIO] }).filtros);
    expect(w).toEqual({ AND: [{ OR: [{ conta: { in: ["Cielo"] } }, { conta: null }] }] });
    expect(filtrosParaWhere(ler({ unidade: VAZIO }).filtros)).toEqual({ AND: [{ unidade: null }] });
  });

  it("cliente só busca no NOME (e no ID do cliente se forem dígitos) — nunca em CPF/CNPJ", () => {
    const texto = JSON.stringify(filtrosParaWhere(ler({ cliente: "Maria" }).filtros));
    expect(texto).toContain("razaoSocial");
    expect(texto).not.toContain("cpfCnpj");
    const dig = JSON.stringify(filtrosParaWhere(ler({ cliente: "12345678000190" }).filtros));
    expect(dig).not.toContain("cpfCnpj");
    expect(dig).not.toContain("clienteConexaId"); // 14 dígitos: não é um ID de cliente (e estouraria o int)
    const id = JSON.stringify(filtrosParaWhere(ler({ cliente: "5001" }).filtros));
    expect(id).toContain("clienteConexaId");
  });

  it("combina todos os filtros com AND", () => {
    const f = ler({
      mes: "2026-09",
      categoria: ["Endereço Fiscal"],
      proporcionado: ["S", "SEM_LV"],
      revisada: "nao",
      status: "Quitada",
      servico: "Batial",
      fatura: "29113",
      valorMin: "10",
      valorMax: "99.90",
    }).filtros;
    const w = filtrosParaWhere(f) as { AND: unknown[] };
    // período, categoria, rateio, revisão, situação, serviço, fatura e faixa de valor
    expect(w.AND).toHaveLength(8);
    expect(w.AND).toContainEqual({ categoria: { in: ["Endereço Fiscal"] } });
    expect(w.AND).toContainEqual({ proporcionado: { in: ["S", "SEM_LV"] } });
    expect(w.AND).toContainEqual({ revisadoManualmente: false });
    expect(w.AND).toContainEqual({ crConexaId: 29113 });
    expect(w.AND).toContainEqual({ valorRecebidoCat: { gte: "10", lte: "99.90" } });
  });
});

describe("descreverFiltros e nome do arquivo", () => {
  it("o Leia-me sempre começa pelo período e diz 'nenhum' quando não há outro filtro", () => {
    expect(descreverFiltros(ler({ mes: "2026-10" }).filtros)).toEqual([
      ["Período (Data de Crédito)", "01/10/2026 a 31/10/2026"],
      ["Outros filtros", "nenhum"],
    ]);
    expect(descreverFiltros(ler({}).filtros)[0]).toEqual(["Período (Data de Crédito)", "todos os meses (sem filtro de data)"]);
    expect(descreverFiltros(ler({ de: "2026-08-15" }).filtros)[0]![1]).toBe("a partir de 15/08/2026");
  });

  it("descreve cada filtro em português, com os vazios legíveis", () => {
    const d = Object.fromEntries(
      descreverFiltros(ler({ mes: "2026-10", conta: [VAZIO, "Cielo"], proporcionado: "SEM_LV", revisada: "sim", valorMin: "10" }).filtros),
    );
    expect(d["Conta"]).toBe("(sem conta informada); Cielo");
    expect(d["Rateio (Proporcionado)"]).toBe("Sem item no Listar Vendas (SEM_LV)");
    expect(d["Revisão manual"]).toBe("somente linhas revisadas manualmente");
    expect(d["Valor Cat. mínimo"]).toMatch(/10,00/);
  });

  it("nome do arquivo: mês inteiro, intervalo, filtrado, todos", () => {
    expect(nomeDoArquivoReceita(ler({ mes: "2026-10" }).filtros)).toBe("Receita_2026-10.xlsx");
    expect(nomeDoArquivoReceita(ler({ de: "2026-10-01", ate: "2026-10-31" }).filtros)).toBe("Receita_2026-10.xlsx");
    expect(nomeDoArquivoReceita(ler({ de: "2026-08-01", ate: "2026-10-31" }).filtros)).toBe("Receita_2026-08-01_a_2026-10-31.xlsx");
    expect(nomeDoArquivoReceita(ler({ mes: "2026-10", categoria: "X" }).filtros)).toBe("Receita_2026-10_filtrado.xlsx");
    expect(nomeDoArquivoReceita(ler({}).filtros)).toBe("Receita_todos-os-meses.xlsx");
    expect(nomeDoArquivoReceita(ler({ de: "2026-10-05" }).filtros, "csv")).toBe("Receita_desde_2026-10-05.csv");
    expect(nomeDoArquivoReceita(ler({ mes: "2026-10" }).filtros)).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
