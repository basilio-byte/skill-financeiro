import { describe, expect, it } from "vitest";
import { readXlsxAsObjects, readXlsxRows } from "@/lib/xlsx/reader";
import { buildXlsx, T } from "@/lib/xlsx/writer";
import {
  coletarExportCompleto,
  ehLinhaDePreenchimento,
  ExportIncompletoError,
  extrairTotalDaGrade,
  lerExport,
  MAX_PAGINAS,
  montarXlsx,
} from "./exports-completos";

/**
 * O defeito de novembro de 2026 (ADR-0036): o export de Contas a Receber passou a vir cortado na primeira página
 * da grade (20 linhas) e a rodada concluiu em silêncio. Estes testes recriam esse defeito com uma fonte falsa e
 * provam que a coleta o RECUSA; e provam que a coleta correta (paginada) entrega exatamente as linhas do Conexa.
 */

const CABECALHO = ["ID", "Unidade", "Razão Social Cliente", "Status", "Valor Recebido", "Data Crédito"];

/** Uma cobrança sintética por ID (valores no formato misto do Conexa: número solto < 1000, texto BR >= 1000). */
const linha = (id: number): string[] => [
  `${id}.0`,
  "SEAHUB",
  `Cliente ${id}`,
  "Quitada",
  id % 2 ? "360.5" : "1.328,62",
  "15/10/2026",
];

/** O arquivo como o Conexa entrega: cabeçalho, dados e a linha de preenchimento no fim (20 colunas de &nbsp;/vazio). */
function xlsxDoConexa(dados: string[][], cabecalho = CABECALHO): Buffer {
  const preenchimento = Array.from({ length: 20 }, (_, i) => T(i % 3 === 0 ? "&nbsp;" : ""));
  return buildXlsx([{ name: "Sheet1", rows: [cabecalho.map(T), ...dados.map((l) => l.map(T)), preenchimento] }]);
}

interface Fonte {
  contarTotal: () => Promise<number>;
  baixarPagina: (pagina: number) => Promise<Buffer>;
  chamadas: { contagens: number; paginas: number[] };
}

/** O Conexa paginado de hoje: `itens` linhas por página, na ordem do ID. */
function conexaPaginado(todas: string[][], itens = 100, opcoes: { totalInformado?: () => number } = {}): Fonte {
  const chamadas = { contagens: 0, paginas: [] as number[] };
  return {
    chamadas,
    contarTotal: async () => {
      chamadas.contagens += 1;
      return opcoes.totalInformado ? opcoes.totalInformado() : todas.length;
    },
    baixarPagina: async (p) => {
      chamadas.paginas.push(p);
      return xlsxDoConexa(todas.slice((p - 1) * itens, p * itens));
    },
  };
}

const semEspera = async () => {};
const ids = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => linha(desde + i));

describe("extrairTotalDaGrade (marcação real do Conexa, medida em 2026-11-11)", () => {
  const grade = (resumo: string, id = "cobranca-grid") =>
    `<div id="${id}" class="opensev-grid-view"><select class="selectItensPerPage"><option value="20" selected>20</option></select></div>${resumo}<ul class="yiiPager"></ul></div>`;

  it("lê o total do resumo '1-20 de N'", () => {
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-20 de 40</div></div>'), "cobranca-grid")).toBe(40);
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-20 de 939</div></div>'), "cobranca-grid")).toBe(939);
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-20 de 1837</div></div>', "venda-grid"), "venda-grid")).toBe(1837);
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-7 de 7</div></div>'), "cobranca-grid")).toBe(7);
  });

  it("tolera separador de milhar e item único sem intervalo", () => {
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-20 de 1.837</div></div>'), "cobranca-grid")).toBe(1837);
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1 de 1</div></div>'), "cobranca-grid")).toBe(1);
  });

  it("grade vazia (td.empty, sem resumo) é ZERO", () => {
    const vazia = `<div id="cobranca-grid"><table><tbody><tr><td colspan="6" class="empty"><span class="empty"></span></td></tr></tbody></table></div>`;
    expect(extrairTotalDaGrade(vazia, "cobranca-grid")).toBe(0);
  });

  it("o botão 'clique para exibir o total' (sem count) NÃO é um total: null", () => {
    const semCount = grade('<div class="page-summary"><div>1-20 de <button title="Clique para exibir o total de itens">muitos</button></div></div>');
    expect(extrairTotalDaGrade(semCount, "cobranca-grid")).toBeNull();
  });

  it("página que não é a grade (login expirado, erro, outra grade) é null — nunca zero", () => {
    expect(extrairTotalDaGrade('<form id="login-form"><input name="LoginForm[username]"></form>', "cobranca-grid")).toBeNull();
    expect(extrairTotalDaGrade("", "cobranca-grid")).toBeNull();
    expect(extrairTotalDaGrade(grade('<div class="page-summary"><div>1-20 de 40</div></div>', "venda-grid"), "cobranca-grid")).toBeNull();
    // a grade certa, mas sem resumo e sem o marcador de vazio: marcação mudou — não é zero
    expect(extrairTotalDaGrade('<div id="cobranca-grid"><table></table></div>', "cobranca-grid")).toBeNull();
  });
});

describe("ehLinhaDePreenchimento / lerExport", () => {
  it("só células vazias, &nbsp; ou NBSP", () => {
    expect(ehLinhaDePreenchimento(["", "&nbsp;", " ", " "])).toBe(true);
    expect(ehLinhaDePreenchimento([])).toBe(true);
    expect(ehLinhaDePreenchimento(["", "0"])).toBe(false);
    expect(ehLinhaDePreenchimento(["&nbsp;x"])).toBe(false);
  });

  it("descarta a linha de preenchimento e mantém as de dados", () => {
    const lido = lerExport(xlsxDoConexa(ids(3)));
    expect(lido.cabecalho).toEqual(CABECALHO);
    expect(lido.dados.map((l) => l[0])).toEqual(["1.0", "2.0", "3.0"]);
  });

  it("arquivo sem cabeçalho é erro", () => {
    const vazio = buildXlsx([{ name: "x", rows: [[T("")]] }]);
    expect(() => lerExport(vazio)).toThrow(ExportIncompletoError);
  });
});

describe("montarXlsx: o arquivo remontado entrega ao parser as MESMAS strings do original", () => {
  it("ida e volta sem perda (dinheiro misto, XML especial, espaços, quebra de linha, vazio)", () => {
    const dados = [
      ["31899.0", "SEA & HUB <Centro>", 'Ana "A" D\'Ávila', "Quitada", "1.328,62", "05/10/2026,05/11/2026"],
      ["31900", "  espaços  ", "linha1\nlinha2", "", "360.5", "15/10/2026"],
      ["31901"], // linha mais curta que o cabeçalho (células finais vazias omitidas pelo Conexa)
    ];
    const buf = montarXlsx("Contas a Receber", CABECALHO, dados);
    const relido = readXlsxRows(buf);
    expect(relido[0]).toEqual(CABECALHO);
    expect(relido[1]).toEqual(dados[0]);
    // célula vazia NO MEIO da linha seguida de valor: o caso que uma célula autofechada estragaria
    expect(relido[2]).toEqual(dados[1]);
    // linha curta: as vazias do fim não existem no arquivo (o parser lê como "")
    expect(relido[3]).toEqual(["31901"]);
    // e pelo caminho que o parser usa de verdade
    const objetos = readXlsxAsObjects(buf);
    expect(objetos[0]!["Valor Recebido"]).toBe("1.328,62");
    expect(objetos[1]!["Valor Recebido"]).toBe("360.5");
    expect(objetos[1]!["Unidade"]).toBe("  espaços  ");
    expect(objetos[2]!["Data Crédito"]).toBe("");
  });

  it("só o cabeçalho (período sem cobranças) é um arquivo válido e vazio", () => {
    expect(readXlsxAsObjects(montarXlsx("CR", CABECALHO, []))).toEqual([]);
  });
});

describe("coletarExportCompleto — Contas a Receber paginado", () => {
  const coletar = (fonte: Fonte, log?: string[]) =>
    coletarExportCompleto({
      rotulo: "Contas a Receber",
      contarTotal: fonte.contarTotal,
      baixarPagina: fonte.baixarPagina,
      itensPorPagina: 100,
      colunaId: "ID",
      esperar: semEspera,
      log: log ? (m) => log.push(m) : undefined,
    });

  it("954 cobranças (outubro real) → 10 páginas, 954 linhas na ordem, sem preenchimento", async () => {
    const todas = ids(954);
    const fonte = conexaPaginado(todas);
    const r = await coletar(fonte);
    expect(fonte.chamadas.paginas).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.paginas).toBe(10);
    expect(r.totalNoConexa).toBe(954);
    expect(r.linhas).toEqual(todas);
    expect(r.tentativas).toBe(1);
    expect(r.bufferOriginal).toBeUndefined();
  });

  it("exatamente 100 (o 10/08 real) → UMA página, sem pedir a segunda", async () => {
    const fonte = conexaPaginado(ids(100));
    const r = await coletar(fonte);
    expect(fonte.chamadas.paginas).toEqual([1]);
    expect(r.linhas).toHaveLength(100);
  });

  it("período sem cobranças → baixa a página 1 só pelo cabeçalho e entrega zero linhas", async () => {
    const fonte = conexaPaginado([]);
    const r = await coletar(fonte);
    expect(fonte.chamadas.paginas).toEqual([1]);
    expect(r.linhas).toEqual([]);
    expect(r.cabecalho).toEqual(CABECALHO);
  });

  it("RECRIA O DEFEITO DE PRODUÇÃO: Conexa ignora a página e devolve sempre as mesmas 20 → recusa, nada é entregue", async () => {
    const todas = ids(954);
    const chamadas = { contagens: 0, paginas: [] as number[] };
    const cortado: Fonte = {
      chamadas,
      contarTotal: async () => {
        chamadas.contagens += 1;
        return 954;
      },
      baixarPagina: async (p) => {
        chamadas.paginas.push(p);
        return xlsxDoConexa(todas.slice(0, 20));
      },
    };
    const log: string[] = [];
    const erro = await coletar(cortado, log).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ExportIncompletoError);
    expect((erro as Error).message).toMatch(/INCOMPLETO após 3 tentativas/);
    expect((erro as Error).message).toMatch(/Nada foi gravado/);
    // as 20 voltam repetidas na página 2: a repetição denuncia o corte já na primeira tentativa
    expect(chamadas.contagens).toBe(3);
    expect(log).toHaveLength(3);
  });

  it("RECRIA O DEFEITO no formato antigo (uma requisição de 20, sem paginação): falta → recusa com os números", async () => {
    const todas = ids(954);
    const erro = await coletarExportCompleto({
      rotulo: "Contas a Receber",
      contarTotal: async () => 954,
      baixarPagina: async () => xlsxDoConexa(todas.slice(0, 20)),
      colunaId: "ID",
      esperar: semEspera,
    }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ExportIncompletoError);
    expect((erro as Error).message).toMatch(/informa 954 item\(ns\).*trouxe 20/);
  });

  it("página do meio veio curta (faltou linha) → tenta de novo e, se persistir, recusa", async () => {
    const todas = ids(250);
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => 250,
      baixarPagina: async (p) => xlsxDoConexa(p === 2 ? todas.slice(100, 190) : todas.slice((p - 1) * 100, p * 100)),
    };
    await expect(coletar(fonte)).rejects.toThrow(/informa 250 item\(ns\) para este filtro e o download trouxe 240/);
  });

  it("cobrança antiga creditada NO MEIO do download (páginas deslizam) → repetição detectada, 2ª tentativa fecha", async () => {
    let todas = ids(250, 1000);
    let pedidas = 0;
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => todas.length,
      baixarPagina: async (p) => {
        pedidas += 1;
        // depois da 1ª página da 1ª tentativa, entra uma cobrança de ID BAIXO (vai para o começo da ordem)
        if (pedidas === 1) {
          const buf = xlsxDoConexa(todas.slice(0, 100));
          todas = [linha(5), ...todas];
          return buf;
        }
        return xlsxDoConexa(todas.slice((p - 1) * 100, p * 100));
      },
    };
    const log: string[] = [];
    const r = await coletar(fonte, log);
    expect(r.tentativas).toBe(2);
    expect(r.linhas).toHaveLength(251);
    expect(new Set(r.linhas.map((l) => l[0])).size).toBe(251);
    expect(log[0]).toMatch(/apareceram em mais de uma página/);
  });

  it("cobrança NOVA (ID alto, vai para o fim) durante o download → sobra é aceita", async () => {
    let todas = ids(150);
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => {
        const n = todas.length;
        todas = [...todas, linha(99_999)]; // entra logo depois da contagem
        return n;
      },
      baixarPagina: async (p) => xlsxDoConexa(todas.slice((p - 1) * 100, p * 100)),
    };
    const log: string[] = [];
    const r = await coletar(fonte, log);
    expect(r.totalNoConexa).toBe(150);
    expect(r.linhas).toHaveLength(151);
    expect(log.join(" ")).toMatch(/entrou item novo/);
  });

  it("o Conexa volta a entregar TUDO na página 1 (show_all honrado) → para na página 1", async () => {
    const todas = ids(954);
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => 954,
      baixarPagina: async (p) => {
        fonte.chamadas.paginas.push(p);
        return xlsxDoConexa(todas);
      },
    };
    const r = await coletar(fonte);
    expect(fonte.chamadas.paginas).toEqual([1]);
    expect(r.linhas).toHaveLength(954);
  });

  it("cabeçalho diferente entre páginas → erro imediato (sem novas tentativas)", async () => {
    let contagens = 0;
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => {
        contagens += 1;
        return 150;
      },
      baixarPagina: async (p) => xlsxDoConexa(ids(100, p * 1000), p === 1 ? CABECALHO : [...CABECALHO.slice(0, 5), "Outra"]),
    };
    await expect(coletar(fonte)).rejects.toThrow(/cabeçalho do export mudou/);
    expect(contagens).toBe(1);
  });

  it("export sem a coluna de ID → erro imediato", async () => {
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => 3,
      baixarPagina: async () => xlsxDoConexa(ids(3), ["Código", ...CABECALHO.slice(1)]),
    };
    await expect(coletar(fonte)).rejects.toThrow(/não tem a coluna "ID"/);
  });

  it("total absurdo → recusa ANTES de baixar qualquer página", async () => {
    const fonte = conexaPaginado([], 100, { totalInformado: () => (MAX_PAGINAS + 1) * 100 });
    await expect(coletar(fonte)).rejects.toThrow(/limite de segurança/);
    expect(fonte.chamadas.paginas).toEqual([]);
  });

  it("total inválido → erro", async () => {
    const fonte = conexaPaginado(ids(3), 100, { totalInformado: () => Number.NaN });
    await expect(coletar(fonte)).rejects.toThrow(/não é um número válido/);
  });

  it("'32616.0' e '32616' são a mesma cobrança (repetição detectada mesmo com formatação diferente)", async () => {
    const fonte: Fonte = {
      chamadas: { contagens: 0, paginas: [] },
      contarTotal: async () => 2,
      baixarPagina: async () => xlsxDoConexa([linha(32616), ["32616", "SEAHUB", "x", "Quitada", "1", "15/10/2026"]]),
    };
    await expect(coletar(fonte)).rejects.toThrow(/apareceram em mais de uma página/);
  });
});

describe("coletarExportCompleto — Listar Vendas (uma requisição, só a conferência)", () => {
  it("fecha com o total → devolve o arquivo ORIGINAL, intocado", async () => {
    const original = xlsxDoConexa(ids(65));
    const r = await coletarExportCompleto({
      rotulo: "Listar Vendas",
      contarTotal: async () => 65,
      baixarPagina: async () => original,
      esperar: semEspera,
    });
    expect(r.bufferOriginal).toBe(original);
    expect(r.linhas).toHaveLength(65);
  });

  it("veio cortado → recusa (a mesma defesa, caso o Conexa pagine também esta tela)", async () => {
    await expect(
      coletarExportCompleto({
        rotulo: "Listar Vendas",
        contarTotal: async () => 1837,
        baixarPagina: async () => xlsxDoConexa(ids(20)),
        esperar: semEspera,
      }),
    ).rejects.toThrow(/Export de Listar Vendas do Conexa INCOMPLETO.*informa 1837 item\(ns\).*trouxe 20/);
  });

  it("espera entre as tentativas cresce (2 s, 4 s)", async () => {
    const esperas: number[] = [];
    await coletarExportCompleto({
      rotulo: "Listar Vendas",
      contarTotal: async () => 10,
      baixarPagina: async () => xlsxDoConexa(ids(9)),
      esperar: async (ms) => {
        esperas.push(ms);
      },
    }).catch(() => {});
    expect(esperas).toEqual([2_000, 4_000]);
  });
});
