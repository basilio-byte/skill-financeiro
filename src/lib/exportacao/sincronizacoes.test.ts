import { readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { buildXlsx, type Sheet } from "@/lib/xlsx/writer";
import { lerAba, lerXml, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { acharConjunto } from "@/lib/exportacao/conjuntos";
import { entregar } from "@/lib/exportacao/empacotar";
import { lerCsv } from "@/lib/exportacao/csv";
import { LIMITE_CELULA, textoSeguro } from "@/lib/exportacao/texto";
import { ExportacaoGrandeDemaisError, ExportacaoInconsistenteError, ExportacaoNegadaError, MAX_LINHAS } from "@/lib/exportacao/tipos";
import {
  COLUNAS_SINC,
  GRUPOS_SINC,
  ROTULO_ORIGEM_SINC,
  ROTULO_STATUS_SINC,
  SINCRONIZACOES_SOMENTE_ADMIN,
  agruparPorDia,
  agruparPorOrigemStatus,
  colunasSinc,
  condicaoSincronizacoes,
  conferirAgregados,
  conferirContraBancoSinc,
  conferirRecorteDeDatas,
  descreverArquivosImportados,
  descreverPedidoSincronizacoes,
  exigirDentroDoTeto,
  faixaDeDias,
  grupoSincPermitido,
  instanteDoInicioDoDia,
  lerPedidoSincronizacoes,
  limitesDoPedido,
  montarAbasSincronizacoes,
  nomeDoArquivoSincronizacoes,
  paraLinhaRodada,
  periodoPadraoDaTela,
  relogioBr,
  resumirRodadas,
  rotuloOrigemSinc,
  rotuloStatusSinc,
  selecaoRodadas,
  somarDias,
  validarPermissoesSincronizacoes,
  type LinhaRodada,
  type ReferenciaBancoSinc,
  type RowRodada,
} from "@/lib/exportacao/pasta-sincronizacoes";

// ---------------------------------------------------------------------------------------------------------------
// Dados de teste: seis rodadas em quatro dias (o dia 03/11 NÃO tem rodada), em instantes UTC (Fortaleza = UTC-3)
// ---------------------------------------------------------------------------------------------------------------

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const em = (iso: string, segundos: number) => new Date(Date.parse(iso) + segundos * 1000);
const HOJE = "2026-11-04";

function row(p: Partial<RowRodada> & Pick<RowRodada, "id" | "iniciadoEm">): RowRodada {
  return {
    concluidoEm: null,
    periodoInicio: dia("2026-11-01"),
    periodoFim: dia("2026-11-30"),
    origem: "AUTOMATICO",
    status: "DONE",
    totalLinhasCR: 0,
    totalLinhasLV: 0,
    totalSemLV: 0,
    totalLinhasNovas: 0,
    totalLinhasAtualizadas: 0,
    totalLinhasOrfasPreservadas: 0,
    totalFaturasComConflito: 0,
    totalRecebido: new Decimal("0"),
    diferencaConferencia: new Decimal("0"),
    erro: null,
    entradaManual: null,
    ...p,
  };
}

const ENTRADA_MANUAL = {
  contasReceber: { nome: "Contas a Receber outubro.xlsx", bytes: 1234, sha256: "a1b2c3d4e5f6" + "0".repeat(52), linhas: 700 },
  listarVendas: { nome: "Listar Vendas outubro.xlsx", bytes: 4321, sha256: "9f8e7d6c5b4a" + "0".repeat(52), linhas: 1300 },
  selo: "abc",
  confirmouRemocaoOuQueda: false,
};

/** Do mais recente para o mais antigo, como a consulta entrega (iniciadoEm desc). */
const ROWS: RowRodada[] = [
  row({ id: "r6", iniciadoEm: new Date("2026-11-04T20:00:00.000Z"), status: "RUNNING" }),
  row({ id: "r3", iniciadoEm: new Date("2026-11-04T19:30:00.000Z"), concluidoEm: em("2026-11-04T19:30:00.000Z", 30), status: "FAILED", erro: "Marque o captcha para continuar" }),
  row({
    id: "r2",
    iniciadoEm: new Date("2026-11-04T19:15:00.000Z"),
    concluidoEm: em("2026-11-04T19:15:00.000Z", 60),
    totalLinhasCR: 887,
    totalLinhasLV: 1639,
    totalSemLV: 21,
    totalLinhasAtualizadas: 887,
    totalRecebido: new Decimal("0.20"),
  }),
  row({
    id: "r1",
    iniciadoEm: new Date("2026-11-04T19:00:00.000Z"),
    concluidoEm: em("2026-11-04T19:00:00.000Z", 45),
    totalLinhasCR: 887,
    totalLinhasLV: 1639,
    totalSemLV: 21,
    totalLinhasNovas: 1,
    totalLinhasAtualizadas: 886,
    totalRecebido: new Decimal("0.10"),
  }),
  row({
    id: "r4",
    iniciadoEm: new Date("2026-11-02T14:00:00.000Z"),
    concluidoEm: em("2026-11-02T14:00:00.000Z", 120),
    origem: "MANUAL",
    totalLinhasCR: 300,
    totalLinhasOrfasPreservadas: 3,
    totalFaturasComConflito: 2,
    totalRecebido: new Decimal("1234567.89"),
    diferencaConferencia: new Decimal("-0.01"),
  }),
  // 23:30 do dia 01/11 em Fortaleza, mas já é 02/11 em UTC: a rodada tem de contar no dia 01.
  row({
    id: "r5",
    iniciadoEm: new Date("2026-11-02T02:30:00.000Z"),
    concluidoEm: em("2026-11-02T02:30:00.000Z", 90),
    origem: "IMPORTACAO",
    totalRecebido: new Decimal("50"),
    entradaManual: ENTRADA_MANUAL,
  }),
];
const LINHAS: LinhaRodada[] = ROWS.map((r) => paraLinhaRodada(r, true));

// Conferidos à mão: 0,00 + 0,00 + 0,20 + 0,10 + 1234567,89 + 50,00
const TOTAL_RECEBIDO = "1234618.19";
const REF: ReferenciaBancoSinc = {
  contagem: 6,
  porOrigemStatus: new Map([
    ["AUTOMATICO|DONE", 2],
    ["AUTOMATICO|FAILED", 1],
    ["AUTOMATICO|RUNNING", 1],
    ["MANUAL|DONE", 1],
    ["IMPORTACAO|DONE", 1],
  ]),
  comErro: 1,
  somaInteiros: { faturasCR: 2074, itensLV: 3278, semLV: 42, linhasNovas: 1, linhasAtualizadas: 1773, orfasPreservadas: 3, faturasComConflito: 2 },
  somaDinheiro: { totalRecebido: TOTAL_RECEBIDO, diferencaConferencia: "-0.01" },
};

const ADMIN = { id: "u1", nome: "Admin", email: "a@t", papel: "ADMIN" as const };
const VIEWER = { id: "u2", nome: "Leitor", email: "v@t", papel: "VIEWER" as const };

const base = {
  linhas: LINHAS,
  geradoEm: new Date("2026-11-04T20:10:00.000Z"),
  usuario: ADMIN,
  frescor: { texto: "Receita sincronizando normalmente. Última sincronização concluída em 04/11/2026 16:16 (há 54 min).", alerta: false },
  hoje: HOJE,
};
const ped = (params: Record<string, string | string[]>) => lerPedidoSincronizacoes(params).pedido;
const PERIODO = { f: "1", resumos: "1", de: "2026-11-01", ate: "2026-11-04" };

/** Número de série do Excel de um instante, no formato que o gerador grava (relógio de parede em UTC). */
const serialHora = (paredeIso: string) => {
  const ms = Date.parse(paredeIso);
  const dias = Math.floor(ms / 86_400_000);
  return String(dias + 25_569 + (ms - dias * 86_400_000) / 86_400_000);
};
const serialDia = (iso: string) => String(Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + 25_569);

const TITULOS_ESSENCIAIS = [
  "Início", "Conclusão", "Duração (s)", "Período de", "Período até", "Origem", "Status", "Faturas CR", "Itens LV", "Sem LV",
  "Linhas novas", "Atualizadas", "Órfãs preservadas", "Faturas com conflito", "Total recebido", "Diferença de conferência", "ID da rodada",
];

const abasDe = (s: { abas: Sheet[] }) => buildXlsx(s.abas);
const leiaMe = (s: { abas: Sheet[] }): Map<string, string> => {
  const m = new Map<string, string>();
  for (const r of lerAba(abasDe(s), "Leia-me").linhas) if (r[0] && r[1] !== undefined) m.set(r[0], r[1]);
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

describe("lerPedidoSincronizacoes", () => {
  it("sem parâmetros: a API NÃO assume período, cobre tudo, só essenciais, resumos ligados", () => {
    const { pedido, erros } = lerPedidoSincronizacoes({});
    expect(erros).toEqual([]);
    expect(pedido).toEqual({ de: null, ate: null, origens: [], status: [], grupos: [], resumos: true });
  });

  it("data malformada, inexistente ou invertida vira ERRO (nunca o histórico inteiro como se fosse o recorte)", () => {
    expect(lerPedidoSincronizacoes({ de: "04/11/2026" }).erros[0]).toMatch(/Data inicial inválida/);
    expect(lerPedidoSincronizacoes({ ate: "2026-02-31" }).erros[0]).toMatch(/Data final inválida/);
    expect(lerPedidoSincronizacoes({ de: "1999-12-31" }).erros[0]).toMatch(/Data inicial inválida/);
    expect(lerPedidoSincronizacoes({ de: "2026-11-04", ate: "2026-11-01" }).erros).toContain("A data inicial é depois da data final.");
    expect(lerPedidoSincronizacoes({ de: "2026-11-04", ate: "2026-11-04" }).erros).toEqual([]);
  });

  it("parâmetro de valor único repetido com valores DIFERENTES é erro (não pega o primeiro em silêncio); repetido igual não", () => {
    expect(lerPedidoSincronizacoes({ de: ["2026-10-01", "2026-10-15"] }).erros).toEqual(['O parâmetro "de" foi enviado 2 vezes com valores diferentes: envie um só.']);
    expect(lerPedidoSincronizacoes({ ate: ["2026-10-01", "2026-10-15", "2026-10-20"] }).erros[0]).toMatch(/"ate" foi enviado 3 vezes/);
    expect(lerPedidoSincronizacoes({ resumos: ["1", "0"] }).erros[0]).toMatch(/"resumos" foi enviado 2 vezes/);
    expect(lerPedidoSincronizacoes({ de: ["2026-10-01", "2026-10-01"] }).erros).toEqual([]);
    expect(lerPedidoSincronizacoes({ de: ["2026-10-01", ""] }).erros).toEqual([]);
  });

  it("origem e status: só os valores exatos do banco; o resto é erro; duplicado e vazio somem", () => {
    const { pedido, erros } = lerPedidoSincronizacoes({ origem: ["MANUAL", "IMPORTACAO", "MANUAL", ""], status: ["FAILED", "DONE"] });
    expect(erros).toEqual([]);
    expect(pedido.origens).toEqual(["MANUAL", "IMPORTACAO"]);
    expect(pedido.status).toEqual(["FAILED", "DONE"]);
    expect(lerPedidoSincronizacoes({ origem: "manual" }).erros[0]).toMatch(/Origem desconhecida \("manual"\): use AUTOMATICO, MANUAL, IMPORTACAO/);
    expect(lerPedidoSincronizacoes({ origem: ["MANUAL", "ROBO"] }).erros).toHaveLength(1);
    expect(lerPedidoSincronizacoes({ status: "SUCCESS" }).erros[0]).toMatch(/Status desconhecido \("SUCCESS"\): use DONE, FAILED, RUNNING/);
  });

  it("grupos: desconhecido é erro, 'essenciais' é aceito sem alarde, e o pedido explícito vale até sem f=1", () => {
    expect(lerPedidoSincronizacoes({ grupos: "segredo" }).erros[0]).toMatch(/Grupo de colunas desconhecido: "segredo"/);
    expect(lerPedidoSincronizacoes({ grupos: ["essenciais"] })).toEqual({ pedido: ped({}), erros: [] });
    expect(lerPedidoSincronizacoes({ grupos: "tecnico" }).pedido.grupos).toEqual(["tecnico"]); // (a API não finge que não viu o pedido)
    expect(lerPedidoSincronizacoes({ f: "1", grupos: ["essenciais", "tecnico"] }).pedido.grupos).toEqual(["tecnico"]);
  });

  it("resumos: ligado sem formulário; com f=1 a caixa ausente é desmarcada; 1/0 explícitos; outro valor é erro", () => {
    expect(ped({}).resumos).toBe(true);
    expect(ped({ f: "1" }).resumos).toBe(false);
    expect(ped({ f: "1", resumos: "1" }).resumos).toBe(true);
    expect(ped({ resumos: "0" }).resumos).toBe(false);
    expect(lerPedidoSincronizacoes({ resumos: "sim" }).erros[0]).toMatch(/Abas de resumo: valor desconhecido \("sim"\)/);
  });

  it("a tela abre nos últimos 30 dias contando hoje (e a API nunca assume isso)", () => {
    expect(periodoPadraoDaTela("2026-11-04")).toEqual({ de: "2026-10-06", ate: "2026-11-04" });
    expect(periodoPadraoDaTela("2026-03-01")).toEqual({ de: "2026-01-31", ate: "2026-03-01" }); // atravessa fevereiro
    expect(periodoPadraoDaTela("2028-03-05")).toEqual({ de: "2028-02-05", ate: "2028-03-05" }); // ano bissexto
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("descrição, nome do arquivo e teto de linhas", () => {
    expect(descreverPedidoSincronizacoes(ped({}))).toEqual([
      ["Período (início da rodada)", "todo o histórico (sem filtro de data) — fuso de Fortaleza, UTC−3"],
      ["Origem", "todas"],
      ["Status", "todos"],
    ]);
    const p = ped({ de: "2026-10-05", ate: "2026-11-04", origem: ["AUTOMATICO", "IMPORTACAO"], status: "FAILED" });
    expect(descreverPedidoSincronizacoes(p)).toEqual([
      ["Período (início da rodada)", "05/10/2026 a 04/11/2026 — fuso de Fortaleza, UTC−3"],
      ["Origem", "Automática; Importação"],
      ["Status", "Falhou"],
    ]);
    expect(descreverPedidoSincronizacoes(ped({ de: "2026-10-05" }))[0]![1]).toMatch(/^a partir de 05\/10\/2026/);
    expect(descreverPedidoSincronizacoes(ped({ ate: "2026-10-05" }))[0]![1]).toMatch(/^até 05\/10\/2026/);

    expect(nomeDoArquivoSincronizacoes(ped({}), HOJE)).toBe("Sincronizacoes_todo-o-historico_2026-11-04.xlsx");
    expect(nomeDoArquivoSincronizacoes(ped({ de: "2026-10-05", ate: "2026-11-04" }), HOJE)).toBe("Sincronizacoes_2026-10-05_a_2026-11-04.xlsx");
    expect(nomeDoArquivoSincronizacoes(p, HOJE, "csv")).toBe("Sincronizacoes_2026-10-05_a_2026-11-04_filtrado.csv");
    expect(nomeDoArquivoSincronizacoes(ped({ de: "2026-10-05" }), HOJE)).toBe("Sincronizacoes_desde_2026-10-05.xlsx");
    expect(nomeDoArquivoSincronizacoes(ped({ ate: "2026-10-05" }), HOJE)).toBe("Sincronizacoes_ate_2026-10-05.xlsx");

    expect(() => exigirDentroDoTeto(MAX_LINHAS)).not.toThrow();
    expect(() => exigirDentroDoTeto(MAX_LINHAS + 1)).toThrow(ExportacaoGrandeDemaisError);
    expect(() => exigirDentroDoTeto(25_000)).toThrow(/25\.000 rodadas.*20\.000.*Filtre por data/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Limites de data no fuso do app (o ponto onde uma rodada das 22h pularia para o dia seguinte)
// ---------------------------------------------------------------------------------------------------------------

describe("limites de data no fuso do app (Fortaleza, UTC-3)", () => {
  it("o dia começa às 03:00 UTC; `ate` inclui o dia INTEIRO (o limite é o início do dia seguinte)", () => {
    expect(instanteDoInicioDoDia("2026-11-04").toISOString()).toBe("2026-11-04T03:00:00.000Z");
    const l = limitesDoPedido({ de: "2026-11-01", ate: "2026-11-04" });
    expect(l.de?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(l.ateExclusivo?.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(limitesDoPedido({ de: null, ate: null })).toEqual({ de: null, ateExclusivo: null });
  });

  it("virada de mês, de ano e dia bissexto", () => {
    expect(limitesDoPedido({ de: null, ate: "2026-10-31" }).ateExclusivo?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(limitesDoPedido({ de: null, ate: "2026-12-31" }).ateExclusivo?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(limitesDoPedido({ de: null, ate: "2028-02-29" }).ateExclusivo?.toISOString()).toBe("2028-03-01T03:00:00.000Z");
  });

  it("uma rodada às 23:59:59 locais do último dia ENTRA; à meia-noite do dia seguinte NÃO; a das 00:00 do primeiro dia ENTRA", () => {
    const { de, ateExclusivo } = limitesDoPedido({ de: "2026-11-04", ate: "2026-11-04" });
    const entra = (iso: string) => {
      const t = Date.parse(iso);
      return t >= de!.getTime() && t < ateExclusivo!.getTime();
    };
    expect(entra("2026-11-04T02:59:59.999Z")).toBe(false); // 23:59:59.999 de 03/11 em Fortaleza
    expect(entra("2026-11-04T03:00:00.000Z")).toBe(true); // 00:00:00 de 04/11
    expect(entra("2026-11-05T02:59:59.999Z")).toBe(true); // 23:59:59.999 de 04/11
    expect(entra("2026-11-05T03:00:00.000Z")).toBe(false); // 00:00:00 de 05/11
    // e o dia que o resumo atribui à rodada é o mesmo que o filtro usa: 02:30Z de 02/11 é 23:30 de 01/11 em Fortaleza
    expect(LINHAS.find((l) => l.id === "r5")!.iniciadoEm.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("a condição do banco: vazia sem filtro; com datas usa gte/lt em instantes; origem e status viram `in`", () => {
    expect(condicaoSincronizacoes(ped({}))).toEqual({});
    expect(condicaoSincronizacoes(ped({ de: "2026-11-01", ate: "2026-11-04" }))).toEqual({
      iniciadoEm: { gte: new Date("2026-11-01T03:00:00.000Z"), lt: new Date("2026-11-05T03:00:00.000Z") },
    });
    expect(condicaoSincronizacoes(ped({ ate: "2026-11-04" }))).toEqual({ iniciadoEm: { lt: new Date("2026-11-05T03:00:00.000Z") } });
    expect(condicaoSincronizacoes(ped({ de: "2026-11-01" }))).toEqual({ iniciadoEm: { gte: new Date("2026-11-01T03:00:00.000Z") } });
    expect(condicaoSincronizacoes(ped({ origem: ["MANUAL", "IMPORTACAO"], status: "FAILED" }))).toEqual({
      origem: { in: ["MANUAL", "IMPORTACAO"] },
      status: { in: ["FAILED"] },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Leitura estreita e mapeamento do banco
// ---------------------------------------------------------------------------------------------------------------

describe("leitura do banco", () => {
  it("a seleção só pede colunas que EXISTEM no modelo, nunca o resumo por categoria, e o texto técnico só com o grupo", () => {
    const campos = new Set<string>(Object.values(Prisma.RevenueSyncRunScalarFieldEnum));
    const sem = selecaoRodadas(false);
    const com = selecaoRodadas(true);
    for (const k of Object.keys(com)) expect(campos.has(k), `campo "${k}" não existe no modelo RevenueSyncRun`).toBe(true);
    expect(Object.keys(sem)).not.toContain("resumoPorCategoria");
    expect(Object.keys(com)).not.toContain("resumoPorCategoria");
    expect(Object.keys(sem)).not.toContain("entradaManual");
    expect(Object.keys(com)).toContain("entradaManual");
    expect(Object.keys(sem)).toContain("erro"); // as contagens de "com erro" precisam dele
    // a seleção traz exatamente o que RowRodada descreve
    expect(Object.keys(com).sort()).toEqual(Object.keys(ROWS[0]!).sort());
  });

  it("converte instantes para o relógio de Fortaleza e dinheiro para string com 2 casas", () => {
    const l = paraLinhaRodada(ROWS.find((r) => r.id === "r4")!, false);
    expect(l.iniciadoEm.toISOString()).toBe("2026-11-02T11:00:00.000Z"); // 14:00Z = 11:00 em Fortaleza
    expect(l.concluidoEm?.toISOString()).toBe("2026-11-02T11:02:00.000Z");
    expect(l.totalRecebido).toBe("1234567.89");
    expect(l.diferencaConferencia).toBe("-0.01");
    expect(paraLinhaRodada(row({ id: "x", iniciadoEm: new Date("2026-11-05T01:00:00.000Z"), totalRecebido: new Decimal("7") }), false).iniciadoEm.toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(paraLinhaRodada(row({ id: "x", iniciadoEm: new Date(), totalRecebido: new Decimal("7") }), false).totalRecebido).toBe("7.00");
  });

  it("cada coluna recebe o campo certo (um valor DIFERENTE em cada campo: nenhuma coluna trocada)", () => {
    const l = paraLinhaRodada(
      row({
        id: "idx",
        iniciadoEm: new Date("2026-11-04T19:00:00.000Z"),
        concluidoEm: new Date("2026-11-04T19:01:05.000Z"),
        periodoInicio: dia("2026-10-01"),
        periodoFim: dia("2026-10-31"),
        origem: "MANUAL",
        status: "FAILED",
        totalLinhasCR: 11,
        totalLinhasLV: 22,
        totalSemLV: 33,
        totalLinhasNovas: 44,
        totalLinhasAtualizadas: 55,
        totalLinhasOrfasPreservadas: 66,
        totalFaturasComConflito: 77,
        totalRecebido: new Decimal("88.80"),
        diferencaConferencia: new Decimal("99.90"),
      }),
      false,
    );
    const v = Object.fromEntries(COLUNAS_SINC.filter((c) => c.grupo === "essenciais").map((c) => [c.titulo, c.valor(l)]));
    expect(v["Duração (s)"]).toBe(65);
    expect(v["Período de"]).toEqual(dia("2026-10-01"));
    expect(v["Período até"]).toEqual(dia("2026-10-31"));
    expect(v["Origem"]).toBe("Manual");
    expect(v["Status"]).toBe("Falhou");
    expect([v["Faturas CR"], v["Itens LV"], v["Sem LV"], v["Linhas novas"], v["Atualizadas"], v["Órfãs preservadas"], v["Faturas com conflito"]]).toEqual([11, 22, 33, 44, 55, 66, 77]);
    expect([v["Total recebido"], v["Diferença de conferência"], v["ID da rodada"]]).toEqual(["88.80", "99.90", "idx"]);
  });

  it("duração: arredonda ao segundo, fica em branco sem conclusão e NÃO esconde conclusão anterior ao início", () => {
    const d = (seg: number | null) => paraLinhaRodada(row({ id: "x", iniciadoEm: new Date("2026-11-04T19:00:00.000Z"), concluidoEm: seg === null ? null : new Date(Date.parse("2026-11-04T19:00:00.000Z") + seg * 1000) }), false).duracaoSegundos;
    expect(d(45.4)).toBe(45);
    expect(d(45.6)).toBe(46);
    expect(d(0)).toBe(0);
    expect(Object.is(d(-0.2), 0)).toBe(true); // nunca -0
    expect(d(null)).toBeNull();
    expect(d(-3)).toBe(-3); // mostrado como veio, não "consertado"
  });

  it("texto do erro e arquivos importados só entram na linha com o grupo técnico (o resto da leitura só sabe SE há erro)", () => {
    const r = ROWS.find((x) => x.id === "r3")!;
    const sem = paraLinhaRodada(r, false);
    expect(sem.temErro).toBe(true);
    expect(sem.erro).toBeNull();
    expect(sem.arquivosImportados).toBeNull();
    expect(paraLinhaRodada(r, true).erro).toBe("Marque o captcha para continuar");
    expect(paraLinhaRodada(row({ id: "x", iniciadoEm: new Date(), erro: "" }), true)).toMatchObject({ temErro: false, erro: null });
  });

  it("arquivos importados: o formato do detalhe da rodada (nome + 8 primeiros caracteres do SHA-256)", () => {
    expect(descreverArquivosImportados(ENTRADA_MANUAL)).toBe("Contas a Receber outubro.xlsx (Contas a Receber, a1b2c3d4) · Listar Vendas outubro.xlsx (Listar Vendas, 9f8e7d6c)");
    expect(paraLinhaRodada(ROWS.find((r) => r.id === "r5")!, true).arquivosImportados).toContain("(Listar Vendas, 9f8e7d6c)");
    expect(descreverArquivosImportados(null)).toBeNull();
    expect(descreverArquivosImportados(undefined)).toBeNull();
  });

  it("forma inesperada de entradaManual nunca derruba a exportação nem some: sai marcada", () => {
    for (const estranho of ["texto solto", 42, [], {}, { contasReceber: { nome: 1 } }, { contasReceber: ENTRADA_MANUAL.contasReceber }, [ENTRADA_MANUAL]]) {
      const t = descreverArquivosImportados(estranho);
      expect(t, JSON.stringify(estranho)).toMatch(/^\[formato não reconhecido\] /);
    }
    expect(descreverArquivosImportados({ x: "y".repeat(500) })!.length).toBeLessThanOrEqual("[formato não reconhecido] ".length + 200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Colunas e permissões
// ---------------------------------------------------------------------------------------------------------------

describe("colunas e permissões", () => {
  it("as colunas essenciais são as do pedido, na ordem; o técnico vem depois e só quando pedido", () => {
    expect(colunasSinc([]).map((c) => c.titulo)).toEqual(TITULOS_ESSENCIAIS);
    expect(colunasSinc(["tecnico"]).map((c) => c.titulo)).toEqual([...TITULOS_ESSENCIAIS, "Erro", "Arquivos importados"]);
    const ids = COLUNAS_SINC.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COLUNAS_SINC) expect(GRUPOS_SINC.map((g) => g.id)).toContain(c.grupo);
  });

  it("erro e arquivos importados (texto livre) estão SOMENTE no grupo de administrador", () => {
    expect(COLUNAS_SINC.filter((c) => c.grupo === "tecnico").map((c) => c.titulo)).toEqual(["Erro", "Arquivos importados"]);
    expect(GRUPOS_SINC.find((g) => g.id === "tecnico")!.somenteAdmin).toBe(true);
    expect(GRUPOS_SINC.find((g) => g.id === "essenciais")).toMatchObject({ fixo: true, somenteAdmin: false });
    expect(grupoSincPermitido("tecnico", "VIEWER")).toBe(false);
    expect(grupoSincPermitido("tecnico", "ADMIN")).toBe(true);
    expect(grupoSincPermitido("essenciais", "VIEWER")).toBe(true);
    expect(grupoSincPermitido("inventado", "ADMIN")).toBe(false);
  });

  // Só roda depois que o conjunto foi ligado em conjuntos.ts (a ligação é feita à parte): evita que o gerador e a lista
  // de conjuntos discordem sobre quem pode pedir e em que formato.
  const ligado = acharConjunto("sincronizacoes");
  it.skipIf(!ligado)("a ligação em conjuntos.ts bate com o que o gerador espera (somenteAdmin e formatos)", () => {
    expect(ligado!.somenteAdmin).toBe(SINCRONIZACOES_SOMENTE_ADMIN);
    expect(ligado!.formatos).toEqual(["xlsx", "csv"]);
  });

  it("o gerador RECUSA (403) o pedido do visualizador pelo detalhe técnico — não o omite em silêncio", () => {
    expect(() => validarPermissoesSincronizacoes(ped({ grupos: "tecnico" }), VIEWER)).toThrow(ExportacaoNegadaError);
    expect(() => validarPermissoesSincronizacoes(ped({ grupos: "tecnico" }), VIEWER)).toThrow(/só pode ser exportado por administradores/);
    expect(() => validarPermissoesSincronizacoes(ped({ grupos: "tecnico" }), ADMIN)).not.toThrow();
    expect(() => validarPermissoesSincronizacoes(ped({}), VIEWER)).not.toThrow();
    expect(() => validarPermissoesSincronizacoes({ grupos: ["inventado"] }, ADMIN)).toThrow(/não está disponível/);
  });

  function espiao(linha: LinhaRodada) {
    const lidos = new Set<string>();
    const p = new Proxy(linha, {
      get(alvo, prop) {
        lidos.add(String(prop));
        return Reflect.get(alvo, prop);
      },
    });
    return { p, lidos };
  }

  it.each(COLUNAS_SINC.map((c) => [c.id, c] as const))("coluna %s lê só os campos que declara — e todos eles", (_id, coluna) => {
    const { p, lidos } = espiao(LINHAS[2]!);
    coluna.valor(p);
    expect([...lidos].sort()).toEqual([...coluna.campos].sort());
    for (const f of coluna.campos) expect(Object.keys(LINHAS[0]!), `${coluna.id} → ${f}`).toContain(f);
  });

  it("sem o grupo técnico a montagem NUNCA toca no texto do erro nem nos arquivos importados", () => {
    const vigiadas = LINHAS.map(
      (l) =>
        new Proxy(l, {
          get(alvo, prop) {
            if (prop === "erro" || prop === "arquivosImportados") throw new Error(`campo sensível lido: ${String(prop)}`);
            return Reflect.get(alvo, prop);
          },
        }),
    );
    expect(() => montarAbasSincronizacoes({ ...base, linhas: vigiadas, pedido: ped(PERIODO) })).not.toThrow();
    expect(() => montarAbasSincronizacoes({ ...base, linhas: vigiadas, pedido: ped({ ...PERIODO, grupos: "tecnico" }) })).toThrow(/campo sensível lido/); // a vigia funciona
  });

  it("os rótulos são os MESMOS da tela (selo de origem e status de /runs): se mudarem lá, este teste acusa", () => {
    const tabela = (arquivo: string, nome: string): Record<string, string> => {
      const fonte = readFileSync(path.resolve(process.cwd(), arquivo), "utf8");
      const bloco = new RegExp(`const\\s+${nome}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\}`).exec(fonte);
      if (!bloco) throw new Error(`${nome} não encontrado em ${arquivo}`);
      return Object.fromEntries([...bloco[1]!.matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    };
    expect(tabela("src/components/selo.tsx", "ROTULO_ORIGEM")).toEqual(ROTULO_ORIGEM_SINC);
    expect(tabela("src/app/(dashboard)/runs/page.tsx", "STATUS_LABEL")).toEqual(ROTULO_STATUS_SINC);
    expect(rotuloOrigemSinc("MANUAL")).toBe("Manual");
    expect(rotuloStatusSinc("RUNNING")).toBe("Sincronizando");
    expect(rotuloStatusSinc("ESTRANHO")).toBe("ESTRANHO"); // valor desconhecido aparece como veio
    expect(rotuloStatusSinc("constructor")).toBe("constructor"); // (e nunca vira função do protótipo)
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Montagem das abas
// ---------------------------------------------------------------------------------------------------------------

describe("montarAbasSincronizacoes", () => {
  it("abas: Leia-me, Rodadas (principal, com autofiltro), Por origem e status, Por dia; sem resumos só as duas primeiras", () => {
    const s = montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) });
    expect(s.abas.map((a) => a.name)).toEqual(["Leia-me", "Rodadas", "Por origem e status", "Por dia"]);
    expect(nomesDasAbas(abasDe(s))).toEqual(["Leia-me", "Rodadas", "Por origem e status", "Por dia"]);
    expect(s.abas[1]!.autoFiltro).toEqual({ primeiraLinha: 1, ultimaLinha: 1 + LINHAS.length, ultimaColuna: TITULOS_ESSENCIAIS.length - 1 });
    expect(s.titulosDasColunas).toEqual(TITULOS_ESSENCIAIS);
    expect(montarAbasSincronizacoes({ ...base, pedido: ped({ f: "1", de: "2026-11-01", ate: "2026-11-04" }) }).abas.map((a) => a.name)).toEqual(["Leia-me", "Rodadas"]);
  });

  it("Rodadas: uma linha por rodada, na ordem recebida, sem rodapé TOTAL, sem linha em branco e sem fórmula", () => {
    const s = montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) });
    const buf = abasDe(s);
    const rod = lerAba(buf, "Rodadas").linhas;
    expect(rod[0]).toEqual(TITULOS_ESSENCIAIS);
    expect(rod).toHaveLength(1 + LINHAS.length); // cabeçalho + 6: nada depois dos dados
    const iId = TITULOS_ESSENCIAIS.indexOf("ID da rodada");
    expect(rod.slice(1).map((r) => r[iId])).toEqual(["r6", "r3", "r2", "r1", "r4", "r5"]);
    expect(rod.some((r) => r[0] === "TOTAL")).toBe(false);
    expect(lerXml(buf, "xl/worksheets/sheet2.xml")).not.toContain("<f>"); // SUBTOTAL é fórmula: não pode haver
  });

  it("a linha de uma rodada concluída leva cada valor no tipo certo (datas de verdade, inteiros, dinheiro exato)", () => {
    const rod = lerAba(abasDe(montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) })), "Rodadas").linhas;
    const r1 = rod.find((r) => r[TITULOS_ESSENCIAIS.indexOf("ID da rodada")] === "r1")!;
    const col = (t: string) => r1[TITULOS_ESSENCIAIS.indexOf(t)];
    expect(col("Início")).toBe(serialHora("2026-11-04T16:00:00Z")); // 19:00Z = 16:00 em Fortaleza
    expect(col("Conclusão")).toBe(serialHora("2026-11-04T16:00:45Z"));
    expect(col("Duração (s)")).toBe("45");
    expect(col("Período de")).toBe(serialDia("2026-11-01"));
    expect(col("Período até")).toBe(serialDia("2026-11-30"));
    expect([col("Origem"), col("Status")]).toEqual(["Automática", "Concluída"]);
    expect([col("Faturas CR"), col("Itens LV"), col("Sem LV"), col("Linhas novas"), col("Atualizadas")]).toEqual(["887", "1639", "21", "1", "886"]);
    expect([col("Total recebido"), col("Diferença de conferência")]).toEqual(["0.10", "0.00"]);
    // a rodada em andamento fica SEM conclusão e SEM duração (em branco, não zero)
    const r6 = rod.find((r) => r[TITULOS_ESSENCIAIS.indexOf("ID da rodada")] === "r6")!;
    expect(r6[TITULOS_ESSENCIAIS.indexOf("Conclusão")] ?? "").toBe("");
    expect(r6[TITULOS_ESSENCIAIS.indexOf("Duração (s)")] ?? "").toBe("");
    expect(r6[TITULOS_ESSENCIAIS.indexOf("Status")]).toBe("Sincronizando");
  });

  it("dinheiro é decimal exato e NUNCA é somado: nem o total, nem 0,1+0,2 em float, aparecem em lugar nenhum do arquivo", () => {
    const s = montarAbasSincronizacoes({ ...base, pedido: ped({ ...PERIODO, grupos: "tecnico" }) });
    const todas = lerAba(abasDe(s), "Rodadas").linhas;
    const iTotal = TITULOS_ESSENCIAIS.indexOf("Total recebido");
    expect(todas.slice(1).map((r) => r[iTotal]).sort()).toEqual(["0.00", "0.00", "0.10", "0.20", "1234567.89", "50.00"]);
    const celulas = (s.abas.flatMap((a) => a.rows.flat()).map((c) => c.num ?? c.text ?? "") as string[]);
    expect(celulas).not.toContain(TOTAL_RECEBIDO); // 1234618.19
    expect(celulas).not.toContain("0.30000000000000004");
    expect(celulas).not.toContain("0.30");
    // e as somas internas de leitura (conferência com o banco) são exatas
    expect(resumirRodadas(LINHAS).rodadas).toBe(6);
    expect(conferirContraBancoSinc(LINHAS, REF)).toEqual([]);
  });

  it("Por origem e status: contagens por grupo, quantas tiveram erro, e TOTAL que fecha com a aba Rodadas", () => {
    const linhas = lerAba(abasDe(montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) })), "Por origem e status").linhas;
    expect(linhas[0]).toEqual(["Origem", "Status", "Rodadas", "Com erro registrado", "Primeira rodada", "Rodada mais recente"]);
    const dados = linhas.slice(1).filter((r) => r[0] && r[0] !== "TOTAL" && r[2]);
    expect(dados.map((r) => r.slice(0, 4))).toEqual([
      ["Automática", "Concluída", "2", "0"],
      ["Automática", "Falhou", "1", "1"],
      ["Automática", "Sincronizando", "1", "0"],
      ["Manual", "Concluída", "1", "0"],
      ["Importação", "Concluída", "1", "0"],
    ]);
    expect(dados[0]![4]).toBe(serialHora("2026-11-04T16:00:00Z")); // primeira rodada automática concluída
    expect(dados[0]![5]).toBe(serialHora("2026-11-04T16:15:00Z")); // a mais recente
    const total = linhas.find((r) => r[0] === "TOTAL")!;
    expect(total.slice(2, 4)).toEqual(["6", "1"]);
    expect(dados.reduce((a, r) => a + Number(r[2]), 0)).toBe(6);
  });

  it("Por dia: conta pelo dia de INÍCIO no fuso do app, lista o dia SEM rodada com zeros e dá a hora da última concluída", () => {
    const linhas = lerAba(abasDe(montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) })), "Por dia").linhas;
    expect(linhas[0]).toEqual(["Dia", "Rodadas", "Concluídas", "Falhas", "Em andamento", "Última concluída em"]);
    const dados = linhas.slice(1, 5);
    expect(dados).toEqual([
      [serialDia("2026-11-01"), "1", "1", "0", "0", serialHora("2026-11-01T23:31:30Z")], // r5: 02:30Z de 02/11 = 23:30 de 01/11
      [serialDia("2026-11-02"), "1", "1", "0", "0", serialHora("2026-11-02T11:02:00Z")],
      [serialDia("2026-11-03"), "0", "0", "0", "0", ""], // o dia em que NADA rodou aparece, com zeros e sem hora de conclusão
      [serialDia("2026-11-04"), "4", "2", "1", "1", serialHora("2026-11-04T16:16:00Z")],
    ]);
    const total = linhas.find((r) => r[0] === "TOTAL")!;
    expect(total.slice(1, 5)).toEqual(["6", "4", "1", "1"]);
  });

  it("Por dia: sem `de` começa na primeira rodada; sem `ate` vai até hoje; o futuro e os pedidos sem nada não geram dias", () => {
    expect(faixaDeDias({ de: null, ate: null, hoje: HOJE, primeiroDia: "2026-11-01", ultimoDia: "2026-11-02" })).toEqual({ inicio: "2026-11-01", fim: HOJE });
    expect(faixaDeDias({ de: "2026-10-30", ate: "2026-12-31", hoje: HOJE, primeiroDia: "2026-11-01", ultimoDia: "2026-11-02" })).toEqual({ inicio: "2026-10-30", fim: HOJE }); // não passa de hoje
    expect(faixaDeDias({ de: "2026-10-30", ate: "2026-11-02", hoje: HOJE, primeiroDia: null, ultimoDia: null })).toEqual({ inicio: "2026-10-30", fim: "2026-11-02" });
    expect(faixaDeDias({ de: null, ate: null, hoje: HOJE, primeiroDia: null, ultimoDia: null })).toBeNull();
    expect(faixaDeDias({ de: "2026-12-01", ate: "2026-12-31", hoje: HOJE, primeiroDia: null, ultimoDia: null })).toBeNull();
    // nunca corta um dia que tenha rodada, mesmo que esteja depois de `ate`
    expect(faixaDeDias({ de: "2026-11-01", ate: "2026-11-02", hoje: HOJE, primeiroDia: "2026-11-01", ultimoDia: "2026-11-03" })?.fim).toBe("2026-11-03");
  });

  it("sem nenhuma rodada o arquivo sai mesmo assim, com os dias do período zerados (a sincronização parou)", () => {
    const s = montarAbasSincronizacoes({ ...base, linhas: [], pedido: ped({ f: "1", resumos: "1", de: "2026-10-30", ate: "2026-11-01" }) });
    const buf = abasDe(s);
    expect(lerAba(buf, "Rodadas").linhas).toEqual([TITULOS_ESSENCIAIS]);
    const dias = lerAba(buf, "Por dia").linhas;
    expect(dias.slice(1, 4)).toEqual([
      [serialDia("2026-10-30"), "0", "0", "0", "0", ""],
      [serialDia("2026-10-31"), "0", "0", "0", "0", ""],
      [serialDia("2026-11-01"), "0", "0", "0", "0", ""],
    ]);
    expect(leiaMe(s).get("Rodadas exportadas")).toBe("0");
    expect(leiaMe(s).has("Primeira rodada no arquivo")).toBe(false);
    // sem pedido de datas e sem rodadas, nada a listar por dia
    expect(lerAba(abasDe(montarAbasSincronizacoes({ ...base, linhas: [], pedido: ped(PERIODO) })), "Por origem e status").linhas.find((r) => r[0] === "TOTAL")!.slice(2, 4)).toEqual(["0", "0"]);
  });

  it("status fora do padrão NÃO é reclassificado: sai como veio, ganha a coluna 'Outro status' e um aviso", () => {
    const estranha = paraLinhaRodada(row({ id: "r7", iniciadoEm: new Date("2026-11-04T21:00:00.000Z"), status: "PAUSADA" }), true);
    const s = montarAbasSincronizacoes({ ...base, linhas: [estranha, ...LINHAS], pedido: ped(PERIODO) });
    const buf = abasDe(s);
    expect(lerAba(buf, "Rodadas").linhas[1]![TITULOS_ESSENCIAIS.indexOf("Status")]).toBe("PAUSADA");
    const dias = lerAba(buf, "Por dia").linhas;
    expect(dias[0]).toEqual(["Dia", "Rodadas", "Concluídas", "Falhas", "Em andamento", "Outro status", "Última concluída em"]);
    expect(dias.find((r) => r[0] === serialDia("2026-11-04"))!.slice(1, 6)).toEqual(["5", "2", "1", "1", "1"]);
    expect(leiaMe(s).get("Com outro status")).toBe("1");
    expect([...leiaMe(s).values()].join("\n")).toContain("status fora do padrão (PAUSADA)");
  });

  it("conclusão ANTERIOR ao início aparece como duração negativa e com aviso (não é consertada)", () => {
    const torta = paraLinhaRodada(row({ id: "r8", iniciadoEm: new Date("2026-11-04T21:00:00.000Z"), concluidoEm: new Date("2026-11-04T20:59:57.000Z") }), true);
    const s = montarAbasSincronizacoes({ ...base, linhas: [torta], pedido: ped(PERIODO) });
    expect(lerAba(abasDe(s), "Rodadas").linhas[1]![TITULOS_ESSENCIAIS.indexOf("Duração (s)")]).toBe("-3");
    expect([...leiaMe(s).values()].join("\n")).toContain("1 rodada(s) têm conclusão ANTERIOR ao início");
    expect([...leiaMe(montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) })).values()].join("\n")).not.toContain("ANTERIOR ao início");
  });

  it("grupo técnico: Erro e Arquivos importados entram no fim da aba Rodadas, com o texto como está", () => {
    const s = montarAbasSincronizacoes({ ...base, pedido: ped({ ...PERIODO, grupos: "tecnico" }) });
    const rod = lerAba(abasDe(s), "Rodadas").linhas;
    expect(rod[0]).toEqual([...TITULOS_ESSENCIAIS, "Erro", "Arquivos importados"]);
    const iId = TITULOS_ESSENCIAIS.indexOf("ID da rodada");
    const iErro = TITULOS_ESSENCIAIS.length;
    expect(rod.find((r) => r[iId] === "r3")![iErro]).toBe("Marque o captcha para continuar");
    expect(rod.find((r) => r[iId] === "r5")![iErro + 1]).toBe("Contas a Receber outubro.xlsx (Contas a Receber, a1b2c3d4) · Listar Vendas outubro.xlsx (Listar Vendas, 9f8e7d6c)");
    expect(rod.find((r) => r[iId] === "r1")![iErro] ?? "").toBe("");
    expect(s.titulosDasColunas).toHaveLength(TITULOS_ESSENCIAIS.length + 2);
  });

  it("Leia-me: recorte, quem gerou, resultado, atualidade, avisos de leitura e fechamento", () => {
    const s = montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) });
    const m = leiaMe(s);
    expect(m.get("Período (início da rodada)")).toBe("01/11/2026 a 04/11/2026 — fuso de Fortaleza, UTC−3");
    expect(m.get("Origem")).toBe("todas");
    expect(m.get("Status")).toBe("todos");
    expect(m.get("Gerado por")).toBe("Admin (a@t)");
    expect(m.get("Gerado em")).toBe("04/11/2026 17:10"); // 20:10Z = 17:10 em Fortaleza
    expect(m.get("Rodadas exportadas")).toBe("6");
    expect(m.get("Concluídas")).toBe("4");
    expect(m.get("Falharam")).toBe("1");
    expect(m.get("Sincronizando (em andamento)")).toBe("1");
    expect(m.get("Primeira rodada no arquivo")).toBe("01/11/2026 23:30");
    expect(m.get("Rodada mais recente no arquivo")).toBe("04/11/2026 17:00");
    expect(m.get("Rodadas com erro registrado")).toBe("1");
    expect(m.get("Rodadas com diferença de conferência")).toBe("1");
    expect(m.get("Rodadas com faturas em conflito")).toBe("1");
    expect(m.get("Colunas da aba Rodadas")).toBe(TITULOS_ESSENCIAIS.join(" · "));
    expect(m.get("Situação")).toBe(base.frescor.texto);
    expect(m.get("Fechamento")).toMatch(/^OK\. A contagem de rodadas \(6\).*as abas de resumo fecham com a aba Rodadas.*relido/);
    const avisos = [...m.entries()].filter(([k]) => k.startsWith("Atenção ")).map(([, v]) => v).join("\n");
    expect(avisos).toContain("NÃO some 'Total recebido' nem 'Diferença de conferência' entre rodadas");
    expect(avisos).toContain("não tem linha de total nem subtotal de dinheiro");
    expect(avisos).toContain("Importação: os arquivos foram enviados por uma pessoa");
    expect(avisos).toContain("hoje (04/11/2026) está em andamento"); // o período chega até hoje
    expect(avisos).not.toContain("Detalhe técnico"); // sem o grupo, sem o alerta de texto livre
  });

  it("Leia-me: o grupo técnico traz o alerta de texto livre; atualidade ruim vira ATENÇÃO; filtros e 'sem resumos' aparecem", () => {
    const tec = leiaMe(montarAbasSincronizacoes({ ...base, pedido: ped({ ...PERIODO, grupos: "tecnico", origem: "AUTOMATICO", status: ["DONE", "FAILED"] }) }));
    expect([...tec.entries()].filter(([k]) => k.startsWith("Atenção ")).map(([, v]) => v).join("\n")).toContain("Detalhe técnico");
    expect(tec.get("Origem")).toBe("Automática");
    expect(tec.get("Status")).toBe("Concluída; Falhou");
    const alerta = leiaMe(montarAbasSincronizacoes({ ...base, frescor: { texto: "A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA (3 falha(s) seguidas).", alerta: true }, pedido: ped(PERIODO) }));
    expect(alerta.get("ATENÇÃO")).toBe("A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA (3 falha(s) seguidas).");
    expect(alerta.has("Situação")).toBe(false);
    const semResumos = leiaMe(montarAbasSincronizacoes({ ...base, pedido: ped({ f: "1", de: "2026-11-01", ate: "2026-11-04" }) }));
    expect(semResumos.get("Fechamento")).not.toContain("abas de resumo");
    expect([...semResumos.values()].join("\n")).not.toContain("A aba Por dia agrupa");
    // período já fechado: a nota do dia de hoje não aparece
    const fechado = leiaMe(montarAbasSincronizacoes({ ...base, linhas: LINHAS.filter((l) => !l.iniciadoEm.toISOString().startsWith("2026-11-04")), pedido: ped({ f: "1", resumos: "1", de: "2026-11-01", ate: "2026-11-03" }) }));
    expect([...fechado.values()].join("\n")).not.toContain("está em andamento");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Conferências: provam que ACUSAM defeito
// ---------------------------------------------------------------------------------------------------------------

describe("conferirContraBancoSinc (prova que a conferência ACUSA defeito da leitura)", () => {
  it("dado íntegro: nenhuma divergência", () => {
    expect(conferirContraBancoSinc(LINHAS, REF)).toEqual([]);
  });

  it("acusa leitura truncada (uma rodada a menos)", () => {
    const p = conferirContraBancoSinc(LINHAS.slice(1), REF);
    expect(p.some((x) => x.includes("rodadas lidas (5) ≠ contagem do banco (6)"))).toBe(true);
    expect(p.some((x) => x.includes('origem|status "AUTOMATICO|RUNNING"'))).toBe(true);
  });

  it("acusa rodada REPETIDA por paginação instável (a contagem bate, mas falta outra)", () => {
    const repetida = [LINHAS[0]!, ...LINHAS.slice(0, 5)]; // r6 duas vezes, r5 sumiu: 6 linhas, 6 ids... só 5 distintos
    const p = conferirContraBancoSinc(repetida, REF);
    expect(p.some((x) => x.includes("repetida(s) na leitura"))).toBe(true);
  });

  it("acusa um centavo de diferença no Total recebido e na Diferença de conferência", () => {
    const mexida = LINHAS.map((l) => (l.id === "r1" ? { ...l, totalRecebido: "0.11" } : l));
    expect(conferirContraBancoSinc(mexida, REF).some((x) => x.includes('"Total recebido" lida (1234618.20) ≠ banco (1234618.19)'))).toBe(true);
    const dif = LINHAS.map((l) => (l.id === "r4" ? { ...l, diferencaConferencia: "0.00" } : l));
    expect(conferirContraBancoSinc(dif, REF).some((x) => x.includes('"Diferença de conferência"'))).toBe(true);
  });

  it("acusa status ou origem trocados e a contagem de erros diferente", () => {
    const troca = LINHAS.map((l) => (l.id === "r3" ? { ...l, status: "DONE" } : l));
    const p = conferirContraBancoSinc(troca, REF);
    expect(p.some((x) => x.includes('"AUTOMATICO|FAILED": lidas 0, banco 1'))).toBe(true);
    expect(p.some((x) => x.includes('"AUTOMATICO|DONE": lidas 3, banco 2'))).toBe(true);
    const origem = LINHAS.map((l) => (l.id === "r4" ? { ...l, origem: "AUTOMATICO" } : l));
    expect(conferirContraBancoSinc(origem, REF).some((x) => x.includes("MANUAL|DONE"))).toBe(true);
    const semErro = LINHAS.map((l) => (l.id === "r3" ? { ...l, temErro: false } : l));
    expect(conferirContraBancoSinc(semErro, REF).some((x) => x.includes("rodadas com erro lidas (0) ≠ banco (1)"))).toBe(true);
  });

  it("acusa coluna de contagem lida errada (cada uma das sete)", () => {
    const campos = ["faturasCR", "itensLV", "semLV", "linhasNovas", "linhasAtualizadas", "orfasPreservadas", "faturasComConflito"] as const;
    const nomes = ["Faturas CR", "Itens LV", "Sem LV", "Linhas novas", "Atualizadas", "Órfãs preservadas", "Faturas com conflito"];
    campos.forEach((campo, i) => {
      const mexida = LINHAS.map((l, k) => (k === 0 ? { ...l, [campo]: l[campo] + 1 } : l));
      expect(conferirContraBancoSinc(mexida, REF).some((x) => x.includes(`soma de "${nomes[i]}"`)), campo).toBe(true);
    });
  });

  it("origem/status que existe só no banco também é acusada", () => {
    const p = conferirContraBancoSinc(LINHAS, { ...REF, porOrigemStatus: new Map([...REF.porOrigemStatus, ["MANUAL|FAILED", 1]]) });
    expect(p.some((x) => x.includes('"MANUAL|FAILED": lidas 0, banco 1'))).toBe(true);
  });
});

describe("conferências internas das abas (provam que ACUSAM defeito do resumo)", () => {
  const porOS = agruparPorOrigemStatus(LINHAS);
  const faixa = faixaDeDias({ de: "2026-11-01", ate: "2026-11-04", hoje: HOJE, primeiroDia: "2026-11-01", ultimoDia: "2026-11-04" });
  const porDia = agruparPorDia(LINHAS, faixa);

  it("resumos íntegros: nenhuma divergência", () => {
    expect(conferirAgregados(LINHAS, porOS, porDia)).toEqual([]);
    expect(porDia.map((d) => d.dia)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("acusa grupo faltando, rodada a mais num dia e um dia cujas partes não somam", () => {
    expect(conferirAgregados(LINHAS, porOS.slice(1), porDia).some((x) => x.startsWith("Por origem e status soma 4 rodadas"))).toBe(true);
    expect(conferirAgregados(LINHAS, porOS, porDia.map((d, i) => (i === 3 ? { ...d, rodadas: d.rodadas + 1 } : d))).some((x) => x.startsWith("Por dia soma 7"))).toBe(true);
    expect(conferirAgregados(LINHAS, porOS, porDia.map((d, i) => (i === 0 ? { ...d, concluidas: 0 } : d))).some((x) => x.includes("Por dia 2026-11-01"))).toBe(true);
    expect(conferirAgregados(LINHAS, porOS.map((g, i) => (i === 1 ? { ...g, comErro: 0 } : g)), porDia).some((x) => x.includes("rodadas com erro"))).toBe(true);
  });

  it("uma rodada fora da faixa de dias entra no resumo mesmo assim (nunca some) — e o recorte de datas a denuncia", () => {
    const so = agruparPorDia(LINHAS, { inicio: "2026-11-02", fim: "2026-11-04" });
    expect(so.reduce((a, d) => a + d.rodadas, 0)).toBe(6);
    expect(conferirRecorteDeDatas(LINHAS, { de: "2026-11-02", ate: "2026-11-04" })[0]).toMatch(/1 rodada\(s\) fora do período pedido \(2026-11-02 a 2026-11-04\)/);
    expect(conferirRecorteDeDatas(LINHAS, { de: "2026-11-01", ate: "2026-11-04" })).toEqual([]);
    expect(conferirRecorteDeDatas(LINHAS, { de: null, ate: null })).toEqual([]);
  });

  it("a montagem se RECUSA a entregar quando uma rodada está fora do período pedido (limite de data calculado errado)", () => {
    expect(() => montarAbasSincronizacoes({ ...base, pedido: ped({ ...PERIODO, de: "2026-11-02" }) })).toThrow(ExportacaoInconsistenteError);
    expect(() => montarAbasSincronizacoes({ ...base, pedido: ped({ ...PERIODO, ate: "2026-11-03" }) })).toThrow(/fora do período pedido/);
    expect(() => montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) })).not.toThrow();
  });

  it("resumo geral: contagens por status, erros, diferenças e conflitos", () => {
    expect(resumirRodadas(LINHAS)).toMatchObject({
      rodadas: 6,
      concluidas: 4,
      falhas: 1,
      emAndamento: 1,
      outroStatus: 0,
      comErro: 1,
      comDiferenca: 1,
      comConflito: 1,
      conclusaoAntesDoInicio: 0,
    });
    expect(relogioBr(resumirRodadas(LINHAS).primeira!)).toBe("01/11/2026 23:30");
    expect(resumirRodadas([])).toMatchObject({ rodadas: 0, primeira: null, maisRecente: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Entrega: leitura de volta do arquivo (xlsx e csv) e texto hostil
// ---------------------------------------------------------------------------------------------------------------

describe("entregar() sobre as abas desta exportação", () => {
  // (montado em beforeAll: se a conferência interna recusar, o erro aparece no teste, não como "nenhum teste")
  let s: ReturnType<typeof montarAbasSincronizacoes>;
  beforeAll(() => {
    s = montarAbasSincronizacoes({ ...base, pedido: ped(PERIODO) });
  });
  const esperado = (nLinhas = LINHAS.length, titulos = s.titulosDasColunas) => [{ nomeAba: "Rodadas", titulos, nLinhas, indiceValor: -1, total: null }];

  it("xlsx íntegro passa na leitura de volta (cabeçalho e linhas); o arquivo é um zip de verdade", () => {
    const e = entregar(s.abas, esperado(), "xlsx", "Rodadas");
    expect(e.extensao).toBe("xlsx");
    expect(e.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(nomesDasAbas(e.buffer)).toEqual(["Leia-me", "Rodadas", "Por origem e status", "Por dia"]);
  });

  it("a leitura de volta ACUSA linha faltando e cabeçalho deslocado (o arquivo não é entregue)", () => {
    expect(() => entregar(s.abas, esperado(LINHAS.length + 1), "xlsx", "Rodadas")).toThrow(ExportacaoInconsistenteError);
    expect(() => entregar(s.abas, esperado(LINHAS.length + 1), "xlsx", "Rodadas")).toThrow(/linha\(s\) de dados, esperado 7/);
    const trocado = [...s.titulosDasColunas];
    [trocado[0], trocado[1]] = [trocado[1]!, trocado[0]!];
    expect(() => entregar(s.abas, esperado(LINHAS.length, trocado), "xlsx", "Rodadas")).toThrow(/cabeçalho da coluna 1/);
  });

  it("csv: só a aba Rodadas, separador ';', BOM, vírgula decimal, datas dd/mm/aaaa; a leitura de volta confere", () => {
    const e = entregar(s.abas, esperado(), "csv", "Rodadas");
    expect(e.extensao).toBe("csv");
    const texto = e.buffer.toString("utf8");
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    const csv = lerCsv(texto);
    expect(csv[0]).toEqual(TITULOS_ESSENCIAIS);
    expect(csv).toHaveLength(1 + LINHAS.length); // sem Leia-me, resumos, TOTAL nem notas
    const r4 = csv.find((r) => r[TITULOS_ESSENCIAIS.indexOf("ID da rodada")] === "r4")!;
    expect(r4[TITULOS_ESSENCIAIS.indexOf("Total recebido")]).toBe("1234567,89");
    expect(r4[TITULOS_ESSENCIAIS.indexOf("Diferença de conferência")]).toBe("-0,01");
    expect(r4[TITULOS_ESSENCIAIS.indexOf("Início")]).toBe("02/11/2026 11:00");
    expect(r4[TITULOS_ESSENCIAIS.indexOf("Período de")]).toBe("01/11/2026");
    expect(r4[TITULOS_ESSENCIAIS.indexOf("Duração (s)")]).toBe("120");
    expect(() => entregar(s.abas, esperado(LINHAS.length - 1), "csv", "Rodadas")).toThrow(/CSV tem 6 linha\(s\) de dados, esperado 5/);
  });

  it("zero rodadas: xlsx e csv saem (só o cabeçalho) e passam na conferência", () => {
    const vazio = montarAbasSincronizacoes({ ...base, linhas: [], pedido: ped(PERIODO) });
    const esp = [{ nomeAba: "Rodadas", titulos: vazio.titulosDasColunas, nLinhas: 0, indiceValor: -1, total: null }];
    expect(() => entregar(vazio.abas, esp, "xlsx", "Rodadas")).not.toThrow();
    expect(lerCsv(entregar(vazio.abas, esp, "csv", "Rodadas").buffer.toString("utf8"))).toEqual([TITULOS_ESSENCIAIS]);
  });
});

describe("texto hostil (erro, nome de arquivo e status vêm de fora)", () => {
  const ERRO_HOSTIL = `=HYPERLINK("http://x","clique")\u0008\u000b<script>alert(1)</script> & "aspas" ; ponto e vírgula\nsegunda linha\u0001 lone\uD800 fim ${"x".repeat(LIMITE_CELULA + 500)}`;
  const NOME_HOSTIL = `=cmd|' /C calc'!A0 "arquivo"; com & <tags>.xlsx`;
  const hostis: LinhaRodada[] = [
    paraLinhaRodada(row({ id: "h1", iniciadoEm: new Date("2026-11-04T19:00:00.000Z"), concluidoEm: new Date("2026-11-04T19:00:10.000Z"), status: "FAILED", erro: ERRO_HOSTIL }), true),
    paraLinhaRodada(
      row({
        id: "h2",
        iniciadoEm: new Date("2026-11-04T18:00:00.000Z"),
        concluidoEm: new Date("2026-11-04T18:00:10.000Z"),
        origem: "IMPORTACAO",
        status: "=1+1", // status é texto livre no banco
        entradaManual: { contasReceber: { nome: NOME_HOSTIL, sha256: "ab".repeat(32) }, listarVendas: { nome: "ok.xlsx", sha256: "cd".repeat(32) } },
      }),
      true,
    ),
  ];
  const pedido = ped({ f: "1", resumos: "1", grupos: "tecnico", de: "2026-11-04", ate: "2026-11-04" });
  let s: ReturnType<typeof montarAbasSincronizacoes>;
  beforeAll(() => {
    s = montarAbasSincronizacoes({ ...base, linhas: hostis, pedido });
  });
  const iId = TITULOS_ESSENCIAIS.indexOf("ID da rodada");
  const iErro = TITULOS_ESSENCIAIS.length;

  it("xlsx: caractere de controle sai, markup é escapado, fórmula vira texto, o teto da célula é respeitado e MARCADO", () => {
    const e = entregar(s.abas, [{ nomeAba: "Rodadas", titulos: s.titulosDasColunas, nLinhas: 2, indiceValor: -1, total: null }], "xlsx", "Rodadas");
    const rod = lerAba(e.buffer, "Rodadas").linhas;
    const erro = rod.find((r) => r[iId] === "h1")![iErro]!;
    expect(erro).toBe(textoSeguro(ERRO_HOSTIL));
    expect(erro.length).toBeLessThanOrEqual(LIMITE_CELULA);
    expect(erro).toContain("texto cortado");
    expect(erro.startsWith('=HYPERLINK("http://x","clique")<script>alert(1)</script> & "aspas"')).toBe(true); // texto, nunca fórmula
    expect(erro).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(lerXml(e.buffer, "xl/worksheets/sheet2.xml")).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(lerXml(e.buffer, "xl/worksheets/sheet2.xml")).not.toContain("<f>");
    // o status "=1+1" e o nome de arquivo perigoso saem como TEXTO, íntegros
    expect(rod.find((r) => r[iId] === "h2")![TITULOS_ESSENCIAIS.indexOf("Status")]).toBe("=1+1");
    expect(rod.find((r) => r[iId] === "h2")![iErro + 1]).toBe(`${NOME_HOSTIL} (Contas a Receber, abababab) · ok.xlsx (Listar Vendas, cdcdcdcd)`);
  });

  it("csv: texto que começa com = + - @ ganha apóstrofo (injeção de fórmula), aspas e quebras de linha são preservadas", () => {
    const e = entregar(s.abas, [{ nomeAba: "Rodadas", titulos: s.titulosDasColunas, nLinhas: 2, indiceValor: -1, total: null }], "csv", "Rodadas");
    const csv = lerCsv(e.buffer.toString("utf8"));
    expect(csv).toHaveLength(3);
    const h1 = csv.find((r) => r[iId] === "h1")!;
    expect(h1[iErro]!.startsWith(`'=HYPERLINK("http://x","clique")`)).toBe(true);
    expect(h1[iErro]).toContain("\nsegunda linha");
    expect(h1[iErro]).toContain('& "aspas" ; ponto e vírgula');
    const h2 = csv.find((r) => r[iId] === "h2")!;
    expect(h2[TITULOS_ESSENCIAIS.indexOf("Status")]).toBe("'=1+1");
    expect(h2[iErro + 1]!.startsWith(`'=cmd|' /C calc'!A0`)).toBe(true); // o nome do arquivo começa com "=": apóstrofo na frente
  });
});
