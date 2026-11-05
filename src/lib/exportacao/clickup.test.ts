import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaDaComposicao, LinhaExcluidaDaComposicao } from "@/lib/clickup/composicao";
import { PadroesVazioError } from "@/lib/clickup/filtro-padroes";
import { limitesDoMes, periodoCorrente } from "@/lib/clickup/periodo-corrente";
import { money, sum, toAmountString } from "@/lib/money";
import { buildXlsx, type Sheet } from "@/lib/xlsx/writer";
import { lerAba, lerXml, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { conferirLeituraDeVolta } from "@/lib/exportacao/conferencia";
import { lerCsv } from "@/lib/exportacao/csv";
import { gerarExportacaoClickUp } from "@/lib/exportacao/clickup";
import { entregar } from "@/lib/exportacao/empacotar";
import {
  assinaturaDosVinculos,
  COLUNAS_COMPOSICAO,
  conferirComposicoes,
  conferirContraBancoClickUp,
  descreverPedidoClickUp,
  erroDeCategoriasDesconhecidas,
  exigirAdministrador,
  impressoesIguais,
  lerPedidoClickUp,
  montarAbasClickUp,
  NOME_ABA_PRINCIPAL,
  nomeDoArquivoClickUp,
  type ComposicaoExportada,
  type EntradaPastaClickUp,
  type EnvioClickUp,
  type LinhaDaPlanilha,
  type LinhaDoBanco,
  type PedidoClickUp,
  type VinculoClickUp,
} from "@/lib/exportacao/pasta-clickup";
import { textoSeguro } from "@/lib/exportacao/texto";
import { ExportacaoGrandeDemaisError, ExportacaoInconsistenteError, ExportacaoInvalidaError, ExportacaoNegadaError, MAX_LINHAS } from "@/lib/exportacao/tipos";

// ---------------------------------------------------------------------------------------------------------------
// Prisma e composição SIMULADOS (sem banco) — só para provar a ORQUESTRAÇÃO de clickup.ts (retry por deriva,
// conferência contra o banco, tetos, só leitura). Os números de verdade são conferidos contra o banco de teste à parte.
// O banco simulado NÃO tem create/update/delete: se o gerador tentasse escrever, o teste quebraria.
// ---------------------------------------------------------------------------------------------------------------

interface FakeVinculo {
  id: string;
  categoria: string;
  padroes: unknown;
  clickUpListId: string;
  clickUpTaskId: string;
  ativo: boolean;
  criadoPorId: string | null;
  criadoPorNome: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}
interface FakeLinha {
  id: string;
  crConexaId: number;
  categoria: string;
  dataCredito: Date | null;
  valorRecebidoCat: string;
  atualizadoEm: Date;
}
interface FakeEnvio {
  id: string;
  vinculoId: string;
  ano: number;
  mes: number;
  valorEnviado: string;
  sucesso: boolean;
  erro: string | null;
  enviadoEm: Date;
}

const h = vi.hoisted(() => {
  const db = {
    vinculos: [] as FakeVinculo[],
    linhas: [] as FakeLinha[],
    envios: [] as FakeEnvio[],
    transacoes: 0,
    opcoesDaTransacao: [] as unknown[],
    leiturasDeEnvios: 0,
    contagemDeEnviosForcada: null as number | null,
  };
  const dec = (v: string) => ({ toString: () => v, toFixed: (n: number) => Number(v).toFixed(n) });
  const em = (alvo: string, filtro?: { in?: string[] }) => !filtro?.in || filtro.in.includes(alvo);
  const ultimoEnvio = (vinculoId: string) =>
    db.envios
      .filter((e) => e.vinculoId === vinculoId)
      .sort((a, b) => b.enviadoEm.getTime() - a.enviadoEm.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 1)
      .map((e) => ({ ...e, valorEnviado: dec(e.valorEnviado) }));
  const doMes = (f: { categoria: { in: string[] }; dataCredito: { gte: Date; lt: Date } }) =>
    db.linhas.filter((l) => f.categoria.in.includes(l.categoria) && l.dataCredito !== null && l.dataCredito >= f.dataCredito.gte && l.dataCredito < f.dataCredito.lt);
  const tx = {
    clickUpVinculo: {
      findMany: async (a: { where?: { categoria?: { in?: string[] } } }) =>
        db.vinculos
          .filter((v) => em(v.categoria, a.where?.categoria))
          .sort((x, y) => (x.categoria < y.categoria ? -1 : x.categoria > y.categoria ? 1 : x.id < y.id ? -1 : 1))
          .map((v) => ({ ...v, criadoPor: v.criadoPorNome ? { name: v.criadoPorNome } : null, pushes: ultimoEnvio(v.id) })),
    },
    revenueCategorizedLine: {
      aggregate: async (a: { where: { categoria: { in: string[] }; dataCredito: { gte: Date; lt: Date } } }) => {
        const rows = doMes(a.where);
        const soma = rows.reduce((t, l) => t + Math.round(Number(l.valorRecebidoCat) * 100), 0) / 100;
        const max = rows.reduce<number | null>((m, l) => (m === null || l.atualizadoEm.getTime() > m ? l.atualizadoEm.getTime() : m), null);
        return { _count: { _all: rows.length }, _sum: { valorRecebidoCat: rows.length ? dec(soma.toFixed(2)) : null }, _max: { atualizadoEm: max === null ? null : new Date(max) } };
      },
      findMany: async (a: { where: { id: { in: string[] } } }) =>
        db.linhas.filter((l) => a.where.id.in.includes(l.id)).map((l) => ({ ...l, valorRecebidoCat: dec(l.valorRecebidoCat) })),
    },
    clickUpPushLog: {
      count: async (a: { where: { vinculoId: { in: string[] }; ano: number; mes: number } }) => {
        db.leiturasDeEnvios += 1;
        return db.contagemDeEnviosForcada ?? db.envios.filter((e) => a.where.vinculoId.in.includes(e.vinculoId) && e.ano === a.where.ano && e.mes === a.where.mes).length;
      },
      findMany: async (a: { where: { vinculoId: { in: string[] }; ano: number; mes: number } }) => {
        db.leiturasDeEnvios += 1;
        return db.envios
          .filter((e) => a.where.vinculoId.in.includes(e.vinculoId) && e.ano === a.where.ano && e.mes === a.where.mes)
          .sort((x, y) => x.enviadoEm.getTime() - y.enviadoEm.getTime())
          .map((e) => ({ ...e, valorEnviado: dec(e.valorEnviado) }));
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>, opcoes?: unknown): Promise<T> => {
      db.transacoes += 1;
      db.opcoesDaTransacao.push(opcoes);
      return fn(tx);
    },
  };
  return { db, prisma, compor: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/exportacao/frescor", () => ({
  frescorDaReceita: async () => ({ texto: "Receita sincronizando normalmente.", alerta: false, situacao: "saudavel", ultimaConcluidaEm: null }),
}));
vi.mock("@/lib/clickup/composicao", () => ({ composicaoDoVinculo: (...args: unknown[]) => h.compor(...args) }));

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Relógio de parede como o servidor entrega (campos UTC lidos como a hora que a pessoa vê). */
const parede = (iso: string) => new Date(`${iso}Z`);
/** Número de série do Excel de uma data. */
const serial = (iso: string) => String(Math.floor(dia(iso).getTime() / 86_400_000) + 25_569);
const HOJE = "2026-11-04";

const ADMIN = { id: "u1", nome: "Admin de Teste", email: "admin@teste.local", papel: "ADMIN" as const };
const VIEWER = { id: "u2", nome: "Visualizador", email: "viewer@teste.local", papel: "VIEWER" as const };

const CAT_ESPACO = "Serviços de Espaço - Seaway Center";
const CAT_SEBRAE = "Salas Privativas -  Sebrae"; // dois espaços: grafia real e distinta
const CAT_FISCAL = "Endereço Fiscal";

// ---------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------

function vinculo(p: Partial<VinculoClickUp> & Pick<VinculoClickUp, "id" | "categoria" | "clickUpTaskId">): VinculoClickUp {
  return {
    padroes: ["padrão"],
    clickUpListId: "901326339447",
    ativo: true,
    criadoPorNome: "Duda",
    criadoEm: parede("2026-01-10T09:30:00"),
    ultimoEnvio: null,
    ...p,
  };
}

let seq = 0;
function linhaComp(p: Partial<LinhaDaComposicao> & Pick<LinhaDaComposicao, "crConexaId" | "valorRecebidoCat">): LinhaDaComposicao {
  seq += 1;
  return {
    id: `l${seq}`,
    razaoSocial: "Cliente & Filhos",
    servicoOuPlano: "[SEAWAY] - SALA 08",
    dataCredito: "2026-10-15T00:00:00.000Z",
    valorAtribuido: p.valorRecebidoCat,
    modo: "linha-inteira",
    dividida: false,
    proporcionado: "N",
    revisadoManualmente: false,
    ...p,
  };
}

function comp(v: VinculoClickUp, incluidas: LinhaDaComposicao[], excluidas: LinhaExcluidaDaComposicao[] = [], total?: string): ComposicaoExportada {
  return { vinculo: v, incluidas, excluidas, total: total ?? toAmountString(sum(incluidas.map((l) => l.valorAtribuido))), erro: null };
}

const excluida = (l: LinhaDaComposicao, taskId: string, extra: Partial<LinhaExcluidaDaComposicao> = {}): LinhaExcluidaDaComposicao => ({
  ...l,
  valorAtribuido: "0.00",
  dividida: false,
  reivindicadaPorTaskId: taskId,
  ...extra,
});

const envio = (vinculoId: string, p: Partial<EnvioClickUp> = {}): EnvioClickUp => ({
  vinculoId,
  ano: 2026,
  mes: 10,
  valor: "0.00",
  sucesso: true,
  erro: null,
  quando: parede("2026-11-03T09:00:00"),
  ...p,
});

// A fatura 27320 do ADR-0028: UMA linha de R$ 123,75 repartida entre duas tarefas (26,25 e 97,50).
const L_DIVIDIDA = linhaComp({
  crConexaId: 27320,
  valorRecebidoCat: "123.75",
  servicoOuPlano: "[SEAWAY] - Cabine; [SEAWAY] - Sala 09; [SEAWAY] - Sala 10",
  dataCredito: "2026-10-20T00:00:00.000Z",
  modo: "por-item",
  proporcionado: "S",
});
const L_INTEIRA = linhaComp({ crConexaId: 100, valorRecebidoCat: "250.00", dataCredito: "2026-10-05T00:00:00.000Z" });
const L_CENTAVOS_A = linhaComp({ crConexaId: 301, valorRecebidoCat: "0.10", servicoOuPlano: "Endereço Fiscal Batial Mensal", razaoSocial: "Ana" });
const L_CENTAVOS_B = linhaComp({ crConexaId: 302, valorRecebidoCat: "0.20", servicoOuPlano: "Endereço Fiscal Batial Mensal", razaoSocial: "Beto", dataCredito: "2026-10-16T00:00:00.000Z" });

const E_V1 = envio("v1", { valor: "276.25", quando: parede("2026-11-03T09:00:00") });
const E_V2_FALHA = envio("v2", { valor: "97.50", sucesso: false, erro: "HTTP 429 <limite> & =cmd", quando: parede("2026-11-02T10:00:00") });
const E_V3_A = envio("v3", { valor: "0.20", quando: parede("2026-10-20T08:00:00") });
const E_V3_B = envio("v3", { valor: "0.25", quando: parede("2026-10-25T08:00:00") });

const V1 = vinculo({ id: "v1", categoria: CAT_ESPACO, clickUpTaskId: "t-sala08", padroes: ["SALA 08", "Cabine"], ultimoEnvio: E_V1 });
const V2 = vinculo({ id: "v2", categoria: CAT_ESPACO, clickUpTaskId: "t-sala09", padroes: ["SALA 09"], ultimoEnvio: E_V2_FALHA, criadoPorNome: null });
const V3 = vinculo({ id: "v3", categoria: CAT_FISCAL, clickUpTaskId: "t-batial", padroes: ["Batial"], ultimoEnvio: E_V3_B });
const V4_INATIVO = vinculo({ id: "v4", categoria: CAT_FISCAL, clickUpTaskId: "t-litoral", padroes: ["Litoral", "Abissal"], ativo: false });

const C1 = comp(
  V1,
  [
    linhaComp({ ...L_DIVIDIDA, valorAtribuido: "26.25", dividida: true, itensAtribuidos: [{ servicoItem: "[SEAWAY] - Cabine", valor: "26.25" }] }),
    L_INTEIRA,
  ],
);
const C2 = comp(
  V2,
  [linhaComp({ ...L_DIVIDIDA, valorAtribuido: "97.50", dividida: true, itensAtribuidos: [{ servicoItem: "[SEAWAY] - Sala 09", valor: "48.75" }, { servicoItem: "[SEAWAY] - Sala 10", valor: "48.75" }] })],
  [excluida(L_INTEIRA, "t-sala08")],
);
const C3 = comp(V3, [L_CENTAVOS_A, L_CENTAVOS_B]);
const C4_INATIVO = comp(V4_INATIVO, [L_CENTAVOS_A]); // hipotético: o mesmo que o V3 (ativo) já leva

// V1 + V2 + V3 (ativos) = 26,25 + 250,00 + 97,50 + 0,10 + 0,20
const TOTAL_ATIVOS = "374.05";

const PEDIDO: PedidoClickUp = { ano: 2026, mes: 10, categorias: [], somenteAtivos: true };

const base = {
  envios: [E_V1, E_V2_FALHA, E_V3_A, E_V3_B],
  geradoEm: new Date("2026-11-04T20:00:00Z"),
  usuario: ADMIN,
  frescor: { texto: "Receita sincronizando normalmente. Última sincronização concluída em 04/11/2026 16:50 (há 10 min).", alerta: false },
  hoje: HOJE,
};

function entrada(p: Partial<EntradaPastaClickUp> = {}): EntradaPastaClickUp {
  return { ...base, pedido: PEDIDO, vinculos: [V1, V2, V3, V4_INATIVO], composicoes: [C1, C2, C3], ...p };
}

/** Linhas posicionais de uma aba, lidas de volta do .xlsx de verdade. */
function lida(abas: Sheet[], nome: string): string[][] {
  return lerAba(buildXlsx(abas), nome).linhas;
}

/** Índice de uma coluna pelo TÍTULO (nunca por posição: uma coluna nova não pode virar o teste do vizinho). */
function indice(linhas: string[][], titulo: string): number {
  const i = (linhas[0] ?? []).indexOf(titulo);
  expect(i, `coluna "${titulo}" não existe`).toBeGreaterThanOrEqual(0);
  return i;
}

/** As linhas de DADOS (sem cabeçalho, sem a linha em branco, sem TOTAL e sem a nota). */
function dados(linhas: string[][], colunaChave = 0): string[][] {
  const fim = linhas.findIndex((r, i) => i > 0 && (r.length === 0 || r[0] === "TOTAL"));
  return linhas.slice(1, fim < 0 ? undefined : fim).filter((r) => (r[colunaChave] ?? "") !== "");
}

const textoDoLeiaMe = (abas: Sheet[]): string =>
  lida(abas, "Leia-me")
    .map((r) => r.join(" | "))
    .join("\n");

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

describe("lerPedidoClickUp", () => {
  it("sem parâmetros: o mês corrente no fuso do app, todas as categorias, só vínculos ativos", () => {
    const { pedido, erros } = lerPedidoClickUp({}, "2026-11-04");
    expect(erros).toEqual([]);
    expect(pedido).toEqual({ ano: 2026, mes: 11, categorias: [], somenteAtivos: true });
    expect(lerPedidoClickUp({}, "2027-01-31").pedido).toMatchObject({ ano: 2027, mes: 1 });
  });

  it("ano e mês válidos (mês com ou sem zero à esquerda)", () => {
    expect(lerPedidoClickUp({ ano: "2025", mes: "3" }, HOJE).pedido).toMatchObject({ ano: 2025, mes: 3 });
    expect(lerPedidoClickUp({ ano: "2025", mes: "03" }, HOJE).pedido).toMatchObject({ ano: 2025, mes: 3 });
    expect(lerPedidoClickUp({ ano: "2026", mes: "12" }, HOJE).erros).toEqual([]);
  });

  it("valor malformado vira ERRO (nunca apura o mês errado em silêncio)", () => {
    expect(lerPedidoClickUp({ ano: "26", mes: "3" }, HOJE).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoClickUp({ ano: "1999", mes: "3" }, HOJE).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoClickUp({ ano: "2101", mes: "3" }, HOJE).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoClickUp({ ano: "abcd", mes: "3" }, HOJE).erros[0]).toMatch(/Ano inválido/);
    expect(lerPedidoClickUp({ ano: "2026", mes: "13" }, HOJE).erros[0]).toMatch(/Mês inválido/);
    expect(lerPedidoClickUp({ ano: "2026", mes: "0" }, HOJE).erros[0]).toMatch(/Mês inválido/);
    expect(lerPedidoClickUp({ ano: "2026", mes: "2026-10" }, HOJE).erros[0]).toMatch(/Mês inválido/);
    expect(lerPedidoClickUp({ ano: "2026", mes: "março" }, HOJE).erros[0]).toMatch(/Mês inválido/);
    expect(lerPedidoClickUp({ ano: "2026", mes: "1.5" }, HOJE).erros[0]).toMatch(/Mês inválido/);
  });

  it("ano sem mês (ou mês sem ano) é ambíguo: erro", () => {
    expect(lerPedidoClickUp({ ano: "2025" }, HOJE).erros.join(" ")).toMatch(/ano e o mês juntos/);
    expect(lerPedidoClickUp({ mes: "3" }, HOJE).erros.join(" ")).toMatch(/ano e o mês juntos/);
  });

  it("ano ou mês repetido com valores diferentes é erro", () => {
    expect(lerPedidoClickUp({ ano: ["2025", "2026"], mes: "3" }, HOJE).erros).toContain("Informe um único ano.");
    expect(lerPedidoClickUp({ ano: "2026", mes: ["3", "4"] }, HOJE).erros).toContain("Informe um único mês.");
    expect(lerPedidoClickUp({ ano: ["2026", "2026"], mes: "3" }, HOJE).erros).toEqual([]);
  });

  it("f=1: a caixa 'somente ativos' ausente = desmarcada; marcada = ativos", () => {
    expect(lerPedidoClickUp({ f: "1" }, HOJE).pedido.somenteAtivos).toBe(false);
    expect(lerPedidoClickUp({ f: "1", somenteAtivos: "1" }, HOJE).pedido.somenteAtivos).toBe(true);
    expect(lerPedidoClickUp({}, HOJE).pedido.somenteAtivos).toBe(true);
  });

  it("categorias: texto EXATO (espaço duplo no meio é real), aparado nas pontas, sem repetição", () => {
    const { pedido } = lerPedidoClickUp({ categoria: [CAT_SEBRAE, `  ${CAT_ESPACO} `, CAT_SEBRAE] }, HOJE);
    expect(pedido.categorias).toEqual([CAT_SEBRAE, CAT_ESPACO]);
    expect(pedido.categorias[0]).toContain("  "); // os dois espaços sobreviveram
    expect(lerPedidoClickUp({ categoria: "" }, HOJE).pedido.categorias).toEqual([]);
  });

  it("categoria sem vínculo é um erro explícito (não uma planilha vazia)", () => {
    const pedido: PedidoClickUp = { ...PEDIDO, categorias: [CAT_ESPACO, "Inexistente"] };
    expect(erroDeCategoriasDesconhecidas(pedido, [CAT_ESPACO, CAT_FISCAL])).toEqual([expect.stringContaining('"Inexistente"')]);
    expect(erroDeCategoriasDesconhecidas({ ...PEDIDO, categorias: [CAT_ESPACO] }, [CAT_ESPACO])).toEqual([]);
    expect(erroDeCategoriasDesconhecidas(PEDIDO, [])).toEqual([]);
    // a diferença de um espaço É diferença: "Sebrae" com um espaço não é a categoria de dois
    expect(erroDeCategoriasDesconhecidas({ ...PEDIDO, categorias: ["Salas Privativas - Sebrae"] }, [CAT_SEBRAE])).toHaveLength(1);
  });

  it("descrição e nome do arquivo", () => {
    expect(descreverPedidoClickUp(PEDIDO)).toEqual([
      ["Mês de apuração (Data de Crédito)", "Outubro de 2026"],
      ["Categoria", "todas as que têm vínculo"],
      ["Vínculos na composição", "somente ativos (os inativos aparecem só na aba Vínculos)"],
    ]);
    expect(descreverPedidoClickUp({ ...PEDIDO, categorias: [CAT_ESPACO, CAT_FISCAL], somenteAtivos: false })).toEqual([
      ["Mês de apuração (Data de Crédito)", "Outubro de 2026"],
      ["Categoria", `${CAT_ESPACO}; ${CAT_FISCAL}`],
      ["Vínculos na composição", "ativos e inativos"],
    ]);
    expect(nomeDoArquivoClickUp(PEDIDO)).toBe("ClickUp_composicao_2026-10.xlsx");
    expect(nomeDoArquivoClickUp({ ...PEDIDO, mes: 3, categorias: [CAT_FISCAL] }, "csv")).toBe("ClickUp_composicao_2026-03_filtrado.csv");
    expect(nomeDoArquivoClickUp({ ...PEDIDO, somenteAtivos: false })).toBe("ClickUp_composicao_2026-10_com_inativos.xlsx");
  });
});

describe("permissão", () => {
  it("só administrador: o gerador recusa com ExportacaoNegadaError mesmo que o link seja montado à mão", () => {
    expect(() => exigirAdministrador(VIEWER)).toThrow(ExportacaoNegadaError);
    expect(() => exigirAdministrador(VIEWER)).toThrow(/administradores/);
    expect(() => exigirAdministrador(ADMIN)).not.toThrow();
  });
});

describe("o mês apurado", () => {
  it("os limites do mês pedido são os MESMOS que o envio usa para o mês corrente (e viram o ano em dezembro)", () => {
    const hoje = periodoCorrente();
    const igual = limitesDoMes(hoje.ano, hoje.mes);
    expect(igual.fromDate.toISOString()).toBe(hoje.fromDate.toISOString());
    expect(igual.toDateExclusive.toISOString()).toBe(hoje.toDateExclusive.toISOString());
    expect(limitesDoMes(2026, 10).fromDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(limitesDoMes(2026, 10).toDateExclusive.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(limitesDoMes(2026, 12).toDateExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// As abas
// ---------------------------------------------------------------------------------------------------------------

describe("montarAbasClickUp", () => {
  it("abas na ordem: Composição (os dados) primeiro, Vínculos, Resumo por vínculo, Excluídas, Envios e o Leia-me por último", () => {
    const s = montarAbasClickUp(entrada());
    expect(s.abas.map((a) => a.name)).toEqual(["Composição", "Vínculos", "Resumo por vínculo", "Excluídas", "Envios", "Leia-me"]);
    expect(nomesDasAbas(buildXlsx(s.abas))).toEqual(s.abas.map((a) => a.name));
    expect(s.esperado.map((e) => e.nomeAba)).toEqual(["Composição", "Vínculos", "Resumo por vínculo", "Excluídas", "Envios"]);
  });

  it("o total é a soma EXATA, em decimal, dos 'Valor atribuído' (0,10 + 0,20 nunca vira 0,30000000000000004)", () => {
    const s = montarAbasClickUp(entrada());
    expect(toAmountString(s.total)).toBe(TOTAL_ATIVOS);
    expect(s.detalhe.total).toBe(TOTAL_ATIVOS);
    expect(s.linhasComposicao).toBe(5);

    const linhas = lida(s.abas, NOME_ABA_PRINCIPAL);
    const iv = indice(linhas, "Valor atribuído ao vínculo");
    expect(toAmountString(sum(dados(linhas, 0).map((r) => r[iv]!)))).toBe(TOTAL_ATIVOS);
    const rodape = linhas.find((r) => r[0] === "TOTAL")!;
    expect(rodape[iv]).toBe(TOTAL_ATIVOS);

    const resumo = lida(s.abas, "Resumo por vínculo");
    const t3 = dados(resumo).find((r) => r[indice(resumo, "Tarefa ClickUp")] === "t-batial")!;
    expect(t3[indice(resumo, "Total atribuído (o que o painel envia)")]).toBe("0.30");
  });

  it("o rodapé soma a coluna CERTA (SUBTOTAL sobre 'Valor atribuído', acompanha o filtro do Excel)", () => {
    const s = montarAbasClickUp(entrada());
    const xml = lerXml(buildXlsx(s.abas), "xl/worksheets/sheet1.xml"); // Composição é a 1ª aba
    const letra = String.fromCharCode(65 + COLUNAS_COMPOSICAO.findIndex((c) => c.titulo === "Valor atribuído ao vínculo"));
    expect(xml).toContain(`SUBTOTAL(109,${letra}2:${letra}6)`);
  });

  it("cada vínculo fecha: a soma das suas linhas é o total da composição (que é o que o painel envia)", () => {
    const s = montarAbasClickUp(entrada());
    const linhas = lida(s.abas, NOME_ABA_PRINCIPAL);
    const [itarefa, iv] = [indice(linhas, "Tarefa ClickUp"), indice(linhas, "Valor atribuído ao vínculo")];
    const porTarefa = new Map<string, string[]>();
    for (const r of dados(linhas)) porTarefa.set(r[itarefa]!, [...(porTarefa.get(r[itarefa]!) ?? []), r[iv]!]);
    expect(toAmountString(sum(porTarefa.get("t-sala08")!))).toBe("276.25");
    expect(toAmountString(sum(porTarefa.get("t-sala09")!))).toBe("97.50");
    expect(toAmountString(sum(porTarefa.get("t-batial")!))).toBe("0.30");
    expect(porTarefa.has("t-litoral")).toBe(false); // inativo: fora da composição
  });

  it("linha dividida: o valor da linha se repete, o atribuído é a parte de cada tarefa, e os itens vão em texto", () => {
    const linhas = lida(montarAbasClickUp(entrada()).abas, NOME_ABA_PRINCIPAL);
    const [itarefa, ifat] = [indice(linhas, "Tarefa ClickUp"), indice(linhas, "ID Fatura")];
    const col = (r: string[], t: string) => r[indice(linhas, t)];
    const doV1 = dados(linhas).find((r) => r[itarefa] === "t-sala08" && r[ifat] === "27320")!;
    const doV2 = dados(linhas).find((r) => r[itarefa] === "t-sala09" && r[ifat] === "27320")!;
    expect(col(doV1, "Valor da linha (Cat.) — NÃO somar")).toBe("123.75");
    expect(col(doV2, "Valor da linha (Cat.) — NÃO somar")).toBe("123.75");
    expect(col(doV1, "Valor atribuído ao vínculo")).toBe("26.25");
    expect(col(doV2, "Valor atribuído ao vínculo")).toBe("97.50");
    expect(col(doV1, "Dividida")).toBe("Sim");
    expect(col(doV1, "Modo")).toBe("por-item");
    expect(col(doV1, "Itens atribuídos a este vínculo")).toBe("[SEAWAY] - Cabine (26,25)");
    expect(col(doV2, "Itens atribuídos a este vínculo")).toBe("[SEAWAY] - Sala 09 (48,75); [SEAWAY] - Sala 10 (48,75)");
    expect(col(doV1, "Proporcionado")).toBe("S");
    // 26,25 + 97,50 = 123,75: as duas partes fecham com a linha (sem duplicar)
    expect(toAmountString(money(col(doV1, "Valor atribuído ao vínculo")!).plus(money(col(doV2, "Valor atribuído ao vínculo")!)))).toBe("123.75");

    const inteira = dados(linhas).find((r) => r[itarefa] === "t-sala08" && r[ifat] === "100")!;
    expect(col(inteira, "Modo")).toBe("linha-inteira");
    expect(col(inteira, "Dividida")).toBe("Não");
    expect(col(inteira, "Itens atribuídos a este vínculo")).toBe(""); // sem detalhe por item: em branco
    expect(col(inteira, "Valor atribuído ao vínculo")).toBe("250.00");
    expect(col(inteira, "Revisada manualmente")).toBe("Não");
    expect(col(inteira, "Data Crédito")).toBe(serial("2026-10-05"));
  });

  it("as linhas de cada vínculo vêm por Data de Crédito e fatura; vínculos por categoria", () => {
    const linhas = lida(montarAbasClickUp(entrada({ composicoes: [C3, C2, C1] })).abas, NOME_ABA_PRINCIPAL);
    const itarefa = indice(linhas, "Tarefa ClickUp");
    const idata = indice(linhas, "Data Crédito");
    expect(dados(linhas).map((r) => r[itarefa])).toEqual(["t-batial", "t-batial", "t-sala08", "t-sala08", "t-sala09"]);
    // ativos primeiro; dentro da categoria, os de 'Endereço Fiscal' antes dos de 'Serviços de Espaço' (ordem alfabética)
    const doV1 = dados(linhas).filter((r) => r[itarefa] === "t-sala08").map((r) => r[idata]);
    expect(doV1).toEqual([serial("2026-10-05"), serial("2026-10-20")]);
  });

  it("vínculos ATIVOS vêm antes dos inativos (na Composição, no Resumo e na aba Vínculos), como na tela", () => {
    const s = montarAbasClickUp(entrada({ pedido: { ...PEDIDO, somenteAtivos: false }, composicoes: [C4_INATIVO, C3, C1, C2] }));
    const compos = lida(s.abas, NOME_ABA_PRINCIPAL);
    expect(dados(compos).map((r) => r[indice(compos, "Tarefa ClickUp")])).toEqual(["t-batial", "t-batial", "t-sala08", "t-sala08", "t-sala09", "t-litoral"]);
    const resumo = lida(s.abas, "Resumo por vínculo");
    expect(dados(resumo).map((r) => r[indice(resumo, "Ativo")])).toEqual(["Sim", "Sim", "Sim", "Não"]);
    const vinc = lida(s.abas, "Vínculos");
    expect(dados(vinc).map((r) => r[indice(vinc, "Ativo")])).toEqual(["Sim", "Sim", "Sim", "Não"]);
  });

  it("Resumo por vínculo: total, último envio COM SUCESSO do mês, diferença e situação", () => {
    const resumo = lida(montarAbasClickUp(entrada()).abas, "Resumo por vínculo");
    const c = (r: string[], t: string) => r[indice(resumo, t)];
    const porTarefa = Object.fromEntries(dados(resumo).map((r) => [r[indice(resumo, "Tarefa ClickUp")]!, r]));

    const v1 = porTarefa["t-sala08"]!;
    expect(c(v1, "Linhas")).toBe("2");
    expect(c(v1, "Total atribuído (o que o painel envia)")).toBe("276.25");
    expect(c(v1, "Último valor enviado neste mês")).toBe("276.25");
    expect(c(v1, "Diferença (atribuído − enviado)")).toBe("0.00");
    expect(c(v1, "Situação")).toBe("Conciliado com o último envio");

    const v2 = porTarefa["t-sala09"]!;
    expect(c(v2, "Excluídas (ficaram com outro vínculo)")).toBe("1");
    expect(c(v2, "Último valor enviado neste mês")).toBe(""); // só houve FALHA: nada chegou ao ClickUp
    expect(c(v2, "Diferença (atribuído − enviado)")).toBe("");
    expect(c(v2, "Situação")).toBe("Sem envio com sucesso neste mês (1 falha(s))");

    const v3 = porTarefa["t-batial"]!;
    expect(c(v3, "Último valor enviado neste mês")).toBe("0.25"); // o MAIS RECENTE dos dois sucessos
    expect(c(v3, "Diferença (atribuído − enviado)")).toBe("0.05");
    expect(c(v3, "Situação")).toMatch(/^Diferente do último envio/);
    expect(c(v3, "Enviado em")).toBe(String(Math.floor(parede("2026-10-25T08:00:00").getTime() / 86_400_000) + 25_569 + (parede("2026-10-25T08:00:00").getTime() % 86_400_000) / 86_400_000));

    const total = resumo.find((r) => r[0] === "TOTAL")!;
    expect(c(total, "Linhas")).toBe("5");
    expect(c(total, "Excluídas (ficaram com outro vínculo)")).toBe("1");
    expect(c(total, "Total atribuído (o que o painel envia)")).toBe(TOTAL_ATIVOS);
    expect(c(total, "Último valor enviado neste mês")).toBe("276.50"); // 276,25 + 0,25: só quem tem envio
    expect(c(total, "Diferença (atribuído − enviado)")).toBe("0.05");
  });

  it("o total do Resumo é o MESMO da aba principal (centavo a centavo)", () => {
    const s = montarAbasClickUp(entrada());
    const resumo = lida(s.abas, "Resumo por vínculo");
    const soma = sum(dados(resumo).map((r) => r[indice(resumo, "Total atribuído (o que o painel envia)")]!));
    expect(toAmountString(soma)).toBe(toAmountString(s.total));
  });

  it("Excluídas: informativa, com para onde foi cada linha, e NUNCA somada (sem rodapé TOTAL)", () => {
    const porItem = linhaComp({ crConexaId: 555, valorRecebidoCat: "60.00", modo: "por-item", dataCredito: "2026-10-22T00:00:00.000Z" });
    const c2 = comp(V2, [], [
      excluida(L_INTEIRA, "t-sala08"),
      excluida(porItem, "t-sala08", { modo: "por-item", dividida: true, repartidaEntre: [{ servicoItem: "Item A", valor: "26.25", taskId: "t-sala08" }, { servicoItem: "Item B", valor: "33.75", taskId: "t-outra" }] }),
    ]);
    const s = montarAbasClickUp(entrada({ composicoes: [C1, c2], vinculos: [V1, V2], envios: [] }));
    const exc = lida(s.abas, "Excluídas");
    expect(exc.some((r) => r[0] === "TOTAL")).toBe(false);
    const c = (r: string[], t: string) => r[indice(exc, t)];
    const linhas = dados(exc);
    expect(linhas).toHaveLength(2);
    const a = linhas.find((r) => c(r, "ID Fatura") === "100")!;
    expect(c(a, "Ficou com (tarefa)")).toBe("t-sala08");
    expect(c(a, "Tarefa ClickUp (que NÃO soma esta linha)")).toBe("t-sala09");
    const b = linhas.find((r) => c(r, "ID Fatura") === "555")!;
    expect(c(b, "Ficou com (tarefa)")).toBe("t-sala08: Item A (26,25); t-outra: Item B (33,75)");
    expect(c(b, "Modo")).toBe("por-item");
    expect(s.linhasExcluidas).toBe(2);
    // o total da principal não tem nada das excluídas
    expect(toAmountString(s.total)).toBe(toAmountString(sum([C1, c2].map((x) => x.total))));
  });

  it("Vínculos: todos do recorte (inclusive os inativos), padrões unidos por ' | ', link da tarefa e último envio", () => {
    const v = lida(montarAbasClickUp(entrada()).abas, "Vínculos");
    const c = (r: string[], t: string) => r[indice(v, t)];
    const linhas = dados(v);
    expect(linhas).toHaveLength(4); // os 3 ativos + o inativo
    const inativo = linhas.find((r) => c(r, "Tarefa ClickUp") === "t-litoral")!;
    expect(c(inativo, "Ativo")).toBe("Não");
    expect(c(inativo, "Padrões (qualquer um casa)")).toBe("Litoral | Abissal");
    expect(c(inativo, "Link da tarefa")).toBe("https://app.clickup.com/t/t-litoral");
    expect(c(inativo, "Último envio: sucesso")).toBe("Nunca enviado");
    expect(c(inativo, "Último envio: valor (se falhou, não chegou ao ClickUp)")).toBe("");

    const v2 = linhas.find((r) => c(r, "Tarefa ClickUp") === "t-sala09")!;
    expect(c(v2, "Ativo")).toBe("Sim");
    expect(c(v2, "Criado por")).toBe(""); // criadoPor null (usuário removido)
    expect(c(v2, "Lista ClickUp")).toBe("901326339447");
    expect(c(v2, "Último envio: sucesso")).toBe("Não");
    expect(c(v2, "Último envio: erro")).toBe("HTTP 429 <limite> & =cmd");
    expect(c(v2, "Último envio: mês/ano")).toBe("10/2026");

    const v1 = linhas.find((r) => c(r, "Tarefa ClickUp") === "t-sala08")!;
    expect(c(v1, "Padrões (qualquer um casa)")).toBe("SALA 08 | Cabine");
    expect(c(v1, "Criado por")).toBe("Duda");
    expect(c(v1, "Último envio: valor (se falhou, não chegou ao ClickUp)")).toBe("276.25");
    expect(c(v1, "ID do vínculo")).toBe("v1");
  });

  it("Envios: ano e mês são números sem separador de milhar, em ordem por vínculo e hora, sem total", () => {
    const e = lida(montarAbasClickUp(entrada()).abas, "Envios");
    const c = (r: string[], t: string) => r[indice(e, t)];
    expect(e.some((r) => r[0] === "TOTAL")).toBe(false);
    const linhas = dados(e);
    expect(linhas.map((r) => c(r, "Tarefa ClickUp"))).toEqual(["t-batial", "t-batial", "t-sala08", "t-sala09"]);
    expect(linhas.map((r) => c(r, "Valor enviado (se falhou, não chegou ao ClickUp)"))).toEqual(["0.20", "0.25", "276.25", "97.50"]);
    expect(c(linhas[0]!, "Ano")).toBe("2026");
    expect(c(linhas[0]!, "Mês")).toBe("10");
    const falha = linhas.find((r) => c(r, "Sucesso") === "Não")!;
    expect(c(falha, "Erro")).toBe("HTTP 429 <limite> & =cmd");
  });

  it("vínculo inativo na composição (somenteAtivos desmarcado): linhas marcadas, totais separados e AVISO, sem falso alerta de duplicidade", () => {
    const s = montarAbasClickUp(entrada({ pedido: { ...PEDIDO, somenteAtivos: false }, composicoes: [C1, C2, C3, C4_INATIVO] }));
    const linhas = lida(s.abas, NOME_ABA_PRINCIPAL);
    const [itarefa, iativo, ialerta] = [indice(linhas, "Tarefa ClickUp"), indice(linhas, "Vínculo ativo"), indice(linhas, "Alerta")];
    const doInativo = dados(linhas).filter((r) => r[itarefa] === "t-litoral");
    expect(doInativo).toHaveLength(1);
    expect(doInativo[0]![iativo]).toBe("Não");
    // a MESMA linha está no t-batial (ativo) e no t-litoral (inativo, hipotético): isso NÃO é dupla contagem do painel
    expect(dados(linhas).every((r) => r[ialerta] === "")).toBe(true);
    expect(s.alertas).toBe(0);
    expect(toAmountString(s.total)).toBe("374.15"); // 374,05 + 0,10 do inativo

    const leia = lida(s.abas, "Leia-me");
    const resultado = (rotulo: string) => leia.find((r) => r[0]?.startsWith(rotulo))?.[1] ?? "";
    expect(resultado("Total atribuído (vínculos ativos")).toMatch(/R\$\s374,05/);
    expect(resultado("Total atribuído (vínculos inativos")).toMatch(/R\$\s0,10/);
    expect(resultado("Soma da coluna 'Valor atribuído'")).toMatch(/R\$\s374,15/);
    expect(textoDoLeiaMe(s.abas)).toContain("INATIVOS");

    const resumo = lida(s.abas, "Resumo por vínculo");
    const lit = dados(resumo).find((r) => r[indice(resumo, "Tarefa ClickUp")] === "t-litoral")!;
    expect(lit[indice(resumo, "Situação")]).toMatch(/^Inativo/);
  });

  it("DUPLA CONTAGEM entre vínculos ativos é MARCADA (coluna Alerta e Leia-me), nunca corrigida nem omitida", () => {
    // defeito injetado: a mesma linha inteira de R$ 250,00 em DOIS vínculos ativos (a composição jamais faz isto)
    const dobrada = comp(V2, [L_INTEIRA]);
    const s = montarAbasClickUp(entrada({ composicoes: [C1, dobrada, C3] }));
    const linhas = lida(s.abas, NOME_ABA_PRINCIPAL);
    const [ifat, ialerta, iv] = [indice(linhas, "ID Fatura"), indice(linhas, "Alerta"), indice(linhas, "Valor atribuído ao vínculo")];
    const marcadas = dados(linhas).filter((r) => r[ifat] === "100");
    expect(marcadas).toHaveLength(2);
    for (const r of marcadas) {
      expect(r[ialerta]).toMatch(/possível dupla contagem/);
      expect(r[ialerta]).toMatch(/R\$\s500,00/);
      expect(r[ialerta]).toMatch(/R\$\s250,00/);
      expect(r[iv]).toBe("250.00"); // o número NÃO foi consertado
    }
    expect(s.alertas).toBe(2);
    expect(textoDoLeiaMe(s.abas)).toMatch(/ATENÇÃO: 2 linha\(s\)/);
    // e o total reflete o que o painel de fato enviaria (com a duplicação), em vez de esconder
    expect(toAmountString(s.total)).toBe(toAmountString(sum([C1, dobrada, C3].map((x) => x.total))));
  });

  it("linha de estorno (valor negativo) levada por dois vínculos ativos também é marcada", () => {
    const estorno = linhaComp({ crConexaId: 900, valorRecebidoCat: "-10.00" });
    const s = montarAbasClickUp(entrada({ composicoes: [comp(V1, [estorno]), comp(V2, [estorno])], vinculos: [V1, V2], envios: [] }));
    expect(s.alertas).toBe(2);
    // uma só vez NÃO é alerta
    expect(montarAbasClickUp(entrada({ composicoes: [comp(V1, [estorno])], vinculos: [V1], envios: [] })).alertas).toBe(0);
  });

  it("composição que NÃO pôde ser calculada vira vínculo marcado (sem linhas, sem total), nunca omitido", () => {
    const quebrado: ComposicaoExportada = { vinculo: V3, incluidas: [], excluidas: [], total: null, erro: "Vínculo sem nenhum padrão — não há o que casar." };
    const s = montarAbasClickUp(entrada({ composicoes: [C1, C2, quebrado] }));
    const resumo = lida(s.abas, "Resumo por vínculo");
    const r = dados(resumo).find((x) => x[indice(resumo, "Tarefa ClickUp")] === "t-batial")!;
    expect(r[indice(resumo, "Situação")]).toMatch(/^NÃO CALCULADO: Vínculo sem nenhum padrão/);
    expect(r[indice(resumo, "Total atribuído (o que o painel envia)")]).toBe("");
    expect(r[indice(resumo, "Linhas")]).toBe("");
    expect(toAmountString(s.total)).toBe("373.75"); // 374,05 − os 0,30 do vínculo sem cálculo: não entram nas somas
    expect(textoDoLeiaMe(s.abas)).toMatch(/ATENÇÃO: 1 vínculo\(s\) NÃO tiveram a composição calculada/);
    expect(montarAbasClickUp(entrada()).abas.length).toBe(s.abas.length);
  });

  it("recorte vazio (mês sem receita ou nenhum vínculo): o arquivo sai, com o total zero, e a leitura de volta confere", () => {
    for (const formato of ["xlsx", "csv"] as const) {
      const s = montarAbasClickUp(entrada({ composicoes: [], vinculos: [], envios: [], soPrincipal: formato === "csv" }));
      expect(s.linhasComposicao).toBe(0);
      expect(toAmountString(s.total)).toBe("0.00");
      const e = entregar(s.abas, s.esperado, formato, NOME_ABA_PRINCIPAL);
      if (formato === "csv") {
        const csv = lerCsv(e.buffer.toString("utf8"));
        expect(csv).toHaveLength(1); // só o cabeçalho
        expect(csv[0]).toEqual(COLUNAS_COMPOSICAO.map((c) => c.titulo));
      }
    }
    expect(textoDoLeiaMe(montarAbasClickUp(entrada({ composicoes: [], vinculos: [], envios: [] })).abas)).toMatch(/Linhas na composição \| 0/);
  });

  it("soPrincipal (CSV): só a Composição, e ainda assim com a conferência interna", () => {
    const s = montarAbasClickUp(entrada({ soPrincipal: true }));
    expect(s.abas.map((a) => a.name)).toEqual(["Composição"]);
    expect(s.esperado).toHaveLength(1);
    expect(toAmountString(s.total)).toBe(TOTAL_ATIVOS);
    const errado = comp(V3, [L_CENTAVOS_A], [], "9.99");
    expect(() => montarAbasClickUp(entrada({ soPrincipal: true, composicoes: [C1, errado] }))).toThrow(ExportacaoInconsistenteError);
  });
});

describe("Leia-me", () => {
  it("traz o recorte, quem gerou, a atualidade da receita, os números e o fechamento", () => {
    const texto = textoDoLeiaMe(montarAbasClickUp(entrada()).abas);
    expect(texto).toContain("Gerado por | Admin de Teste (admin@teste.local)");
    expect(texto).toContain("Mês de apuração (Data de Crédito) | Outubro de 2026");
    expect(texto).toContain("Vínculos no recorte | 4 (3 ativos, 1 inativo)");
    expect(texto).toContain("Vínculos com composição calculada | 3 de 3");
    expect(texto).toContain("Linhas na composição | 5");
    expect(texto).toContain("Linhas excluídas (ficaram com outro vínculo; nunca somadas) | 1");
    expect(texto).toContain("Envios neste mês | 4 (1 com falha)");
    expect(texto).toContain("1 conciliado(s), 1 diferente(s), 1 sem envio com sucesso neste mês");
    expect(texto).toContain("Receita sincronizando normalmente.");
    expect(texto).toContain("Conferência");
    expect(texto).toMatch(/Fechamento \| OK\./);
    expect(texto).toContain("Só a coluna 'Valor atribuído ao vínculo' soma");
    expect(texto).toContain("RECALCULADA");
    expect(texto).not.toContain("INATIVOS"); // sem inativos na composição, o aviso não aparece
  });

  it("a receita parada vira ATENÇÃO", () => {
    const abas = montarAbasClickUp(entrada({ frescor: { texto: "A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA (3 falha(s) seguidas).", alerta: true } })).abas;
    expect(lida(abas, "Leia-me").find((r) => r[0] === "ATENÇÃO")?.[1]).toMatch(/PARADA/);
  });

  it("diz em que pé está o mês: em andamento, encerrado ou futuro", () => {
    const frase = (hoje: string) => textoDoLeiaMe(montarAbasClickUp(entrada({ hoje })).abas);
    expect(frase("2026-10-20")).toMatch(/em andamento/);
    expect(frase("2026-11-04")).toMatch(/Mês encerrado: o painel só envia o mês CORRENTE/);
    expect(frase("2026-09-30")).toMatch(/ainda não começou/);
  });

  it("passando de 300 vínculos o Leia-me avisa que a geração é lenta (e não antes)", () => {
    const muitos = (n: number) => Array.from({ length: n }, (_, i) => comp(vinculo({ id: `x${i}`, categoria: CAT_FISCAL, clickUpTaskId: `tx${i}` }), []));
    const com = montarAbasClickUp(entrada({ composicoes: muitos(301), vinculos: [], envios: [] }));
    expect(textoDoLeiaMe(com.abas)).toMatch(/calculou 301 composições \(uma consulta ao banco por vínculo\)/);
    const sem = montarAbasClickUp(entrada({ composicoes: muitos(300), vinculos: [], envios: [] }));
    expect(textoDoLeiaMe(sem.abas)).not.toMatch(/uma consulta ao banco por vínculo/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A conferência ACUSA defeito (não basta passar quando está certo)
// ---------------------------------------------------------------------------------------------------------------

describe("conferência interna: acusa defeito injetado", () => {
  it("o total da composição diferente da soma das linhas listadas é ERRO (a planilha não sai)", () => {
    const errado = comp(V3, [L_CENTAVOS_A, L_CENTAVOS_B], [], "0.31");
    expect(conferirComposicoes([errado])[0]).toMatch(/t-batial.*2 linha\(s\) listada\(s\) somam 0\.30, mas a composição diz 0\.31/);
    expect(() => montarAbasClickUp(entrada({ composicoes: [C1, C2, errado] }))).toThrow(ExportacaoInconsistenteError);
    expect(() => montarAbasClickUp(entrada({ composicoes: [C1, C2, errado] }))).toThrow(/não foi entregue/);
  });

  it("uma linha PERDIDA na listagem (o total diz uma coisa, a lista soma outra) é acusada", () => {
    const perdida: ComposicaoExportada = { ...C1, incluidas: C1.incluidas.slice(0, 1) }; // total continua 276,25
    expect(conferirComposicoes([perdida])[0]).toMatch(/somam 26\.25, mas a composição diz 276\.25/);
  });

  it("linha repetida dentro do vínculo, e linha ao mesmo tempo incluída e excluída, são acusadas", () => {
    const repetida = comp(V3, [L_CENTAVOS_A, L_CENTAVOS_A]);
    expect(conferirComposicoes([repetida]).join(" ")).toMatch(/aparece duas vezes/);
    const ambas = comp(V1, [L_INTEIRA], [excluida(L_INTEIRA, "t-sala09")]);
    expect(conferirComposicoes([ambas]).join(" ")).toMatch(/ao mesmo tempo incluída e excluída/);
  });

  it("composição com erro não pode trazer linhas nem total", () => {
    expect(conferirComposicoes([{ vinculo: V3, incluidas: [L_CENTAVOS_A], excluidas: [], total: "0.10", erro: "x" }])[0]).toMatch(/com erro não pode trazer/);
    expect(conferirComposicoes([{ vinculo: V3, incluidas: [], excluidas: [], total: null, erro: null }])[0]).toMatch(/sem total/);
  });

  it("composições certas não geram nenhum problema", () => {
    expect(conferirComposicoes([C1, C2, C3, C4_INATIVO])).toEqual([]);
  });

  it("envio de um vínculo que não está no recorte é erro (não some nem entra em silêncio)", () => {
    expect(() => montarAbasClickUp(entrada({ envios: [envio("fantasma", { valor: "1.00" })] }))).toThrow(/envio\(s\) de vínculo\(s\) que não estão no recorte/);
  });
});

describe("conferência contra o banco (linhas relidas na transação de leitura)", () => {
  const periodo = { de: dia("2026-10-01"), ateExclusivo: dia("2026-11-01") };
  const doBanco = (...comps: ComposicaoExportada[]): Map<string, LinhaDoBanco> => {
    const m = new Map<string, LinhaDoBanco>();
    for (const c of comps) {
      for (const l of [...c.incluidas, ...c.excluidas]) {
        m.set(l.id, { id: l.id, crConexaId: l.crConexaId, categoria: c.vinculo.categoria, dataCredito: l.dataCredito ? new Date(l.dataCredito) : null, valorRecebidoCat: l.valorRecebidoCat });
      }
    }
    return m;
  };

  it("fecha quando o banco tem as mesmas linhas, categoria, mês, fatura e valor", () => {
    expect(conferirContraBancoClickUp([C1, C2, C3], doBanco(C1, C2, C3), periodo)).toEqual([]);
  });

  it("acusa linha que sumiu do banco", () => {
    const banco = doBanco(C1, C2, C3);
    banco.delete(L_INTEIRA.id);
    expect(conferirContraBancoClickUp([C1], banco, periodo).join(" ")).toMatch(/não existe mais no banco/);
  });

  it("acusa valor diferente (linha mudou entre a composição e a transação)", () => {
    const banco = doBanco(C3);
    banco.set(L_CENTAVOS_A.id, { ...banco.get(L_CENTAVOS_A.id)!, valorRecebidoCat: "0.11" });
    expect(conferirContraBancoClickUp([C3], banco, periodo)[0]).toMatch(/vale 0\.10 na planilha e 0\.11 no banco/);
  });

  it("acusa categoria diferente, Data de Crédito fora do mês (ou vazia) e fatura diferente", () => {
    const banco = doBanco(C3);
    banco.set(L_CENTAVOS_A.id, { ...banco.get(L_CENTAVOS_A.id)!, categoria: "Outra" });
    banco.set(L_CENTAVOS_B.id, { ...banco.get(L_CENTAVOS_B.id)!, dataCredito: dia("2026-11-01") }); // o limite é exclusivo
    expect(conferirContraBancoClickUp([C3], banco, periodo).join(" ")).toMatch(/categoria "Outra"/);
    expect(conferirContraBancoClickUp([C3], banco, periodo).join(" ")).toMatch(/está fora do mês pedido/);

    const vazia = doBanco(C3);
    vazia.set(L_CENTAVOS_A.id, { ...vazia.get(L_CENTAVOS_A.id)!, dataCredito: null });
    expect(conferirContraBancoClickUp([C3], vazia, periodo).join(" ")).toMatch(/\(vazia\)/);

    const fatura = doBanco(C3);
    fatura.set(L_CENTAVOS_A.id, { ...fatura.get(L_CENTAVOS_A.id)!, crConexaId: 999 });
    expect(conferirContraBancoClickUp([C3], fatura, periodo).join(" ")).toMatch(/o banco diz fatura 999/);
  });

  it("confere também as linhas Excluídas, e resume quando há problema demais", () => {
    const banco = doBanco(C2);
    banco.delete(L_INTEIRA.id); // está só em `excluidas` de C2
    expect(conferirContraBancoClickUp([C2], banco, periodo).join(" ")).toMatch(/não existe mais/);

    const muitas = Array.from({ length: 30 }, (_, i) => linhaComp({ crConexaId: 1000 + i, valorRecebidoCat: "1.00" }));
    const p = conferirContraBancoClickUp([comp(V3, muitas)], new Map(), periodo);
    expect(p).toHaveLength(13); // 12 + o resumo
    expect(p[12]).toBe("… e mais 18 divergência(s)");
  });
});

describe("impressão digital das linhas e dos vínculos (a composição lê o banco fora da transação)", () => {
  const a = { linhas: 840, soma: "270636.89", ultimaAtualizacao: 1_762_000_000_000 };

  it("iguais quando nada mudou; qualquer diferença (contagem, soma, última atualização) acusa", () => {
    expect(impressoesIguais(a, { ...a })).toBe(true);
    expect(impressoesIguais(a, { ...a, soma: "270636.890" })).toBe(true); // mesmo valor, outra grafia
    expect(impressoesIguais(a, { ...a, linhas: 841 })).toBe(false);
    expect(impressoesIguais(a, { ...a, soma: "270636.88" })).toBe(false);
    expect(impressoesIguais(a, { ...a, ultimaAtualizacao: 1_762_000_000_001 })).toBe(false);
    expect(impressoesIguais(a, { ...a, ultimaAtualizacao: null })).toBe(false);
    expect(impressoesIguais({ linhas: 0, soma: "0.00", ultimaAtualizacao: null }, { linhas: 0, soma: "0", ultimaAtualizacao: null })).toBe(true);
  });

  const v = (id: string, p: Partial<{ ativo: boolean; padroes: unknown; categoria: string; atualizadoEm: Date }> = {}) => ({
    id,
    categoria: CAT_FISCAL,
    padroes: ["Batial"],
    ativo: true,
    clickUpTaskId: `t-${id}`,
    atualizadoEm: new Date("2026-10-01T10:00:00Z"),
    ...p,
  });

  it("a assinatura dos vínculos não depende da ordem e muda com ativo, padrões, categoria ou edição", () => {
    const base = assinaturaDosVinculos([v("a"), v("b")]);
    expect(assinaturaDosVinculos([v("b"), v("a")])).toBe(base);
    expect(assinaturaDosVinculos([v("a", { ativo: false }), v("b")])).not.toBe(base);
    expect(assinaturaDosVinculos([v("a", { padroes: ["Batial", "Litoral"] }), v("b")])).not.toBe(base);
    expect(assinaturaDosVinculos([v("a", { categoria: "Outra" }), v("b")])).not.toBe(base);
    expect(assinaturaDosVinculos([v("a", { atualizadoEm: new Date("2026-10-01T10:00:01Z") }), v("b")])).not.toBe(base);
    expect(assinaturaDosVinculos([v("a")])).not.toBe(base); // vínculo apagado no meio
  });
});

// ---------------------------------------------------------------------------------------------------------------
// O arquivo: xlsx e csv conferidos lendo de volta
// ---------------------------------------------------------------------------------------------------------------

describe("arquivo entregue (conferido lendo de volta)", () => {
  it("xlsx: todas as abas, cabeçalhos, linhas e a soma da principal batem", () => {
    const s = montarAbasClickUp(entrada());
    const e = entregar(s.abas, s.esperado, "xlsx", NOME_ABA_PRINCIPAL);
    expect(e.extensao).toBe("xlsx");
    expect(nomesDasAbas(e.buffer)).toEqual(["Composição", "Vínculos", "Resumo por vínculo", "Excluídas", "Envios", "Leia-me"]);
    // dinheiro é NÚMERO de verdade (o Excel soma), nunca texto formatado
    const linhas = lerAba(e.buffer, NOME_ABA_PRINCIPAL).linhas;
    for (const r of dados(linhas)) expect(r[indice(linhas, "Valor atribuído ao vínculo")]).toMatch(/^-?\d+\.\d{2}$/);
  });

  it("a leitura de volta ACUSA: total esperado errado, cabeçalho errado, linha a menos e número virando texto", () => {
    const s = montarAbasClickUp(entrada());
    const principal = s.esperado[0]!;
    const rest = s.esperado.slice(1);
    expect(() => entregar(s.abas, [{ ...principal, total: "374.06" }, ...rest], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(ExportacaoInconsistenteError);
    expect(() => entregar(s.abas, [{ ...principal, total: "374.06" }, ...rest], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(/soma lida do arquivo \(374\.05\) ≠ esperada \(374\.06\)/);
    expect(() => entregar(s.abas, [{ ...principal, titulos: ["Outro título", ...principal.titulos.slice(1)] }, ...rest], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(/cabeçalho da coluna 1/);
    // uma linha A MAIS do que o arquivo tem: a leitura cai na linha em branco ("não é número") e o rodapé fica fora do lugar
    expect(() => entregar(s.abas, [{ ...principal, nLinhas: principal.nLinhas + 1 }, ...rest], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(/valor "" não é número.*rodapé TOTAL não está onde deveria/);
    // e uma linha a MENOS: a soma lida não fecha com a esperada
    expect(() => entregar(s.abas, [{ ...principal, nLinhas: principal.nLinhas - 1 }, ...rest], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(/soma lida do arquivo \(.*\) ≠ esperada \(374\.05\)/);
    expect(() => entregar(s.abas, [...s.esperado, { nomeAba: "Vínculos", titulos: ["x"], nLinhas: 99, indiceValor: -1, total: null }], "xlsx", NOME_ABA_PRINCIPAL)).toThrow(/Vínculos: o arquivo tem/);

    const lidaPrincipal = lerAba(buildXlsx(s.abas), NOME_ABA_PRINCIPAL).linhas;
    const esperado = { titulos: s.titulosDasColunas, nLinhas: s.linhasComposicao, indiceValor: s.detalhe.indiceColunaTotal, total: TOTAL_ATIVOS };
    expect(conferirLeituraDeVolta(lidaPrincipal, esperado)).toEqual([]);
    const ruim = lidaPrincipal.map((r) => [...r]);
    ruim[1]![esperado.indiceValor] = "R$ 26,25";
    expect(conferirLeituraDeVolta(ruim, esperado).some((p) => p.includes("não é número"))).toBe(true);
  });

  it("csv: só a Composição, vírgula decimal, datas dd/mm/aaaa, soma da coluna de valor = total", () => {
    const s = montarAbasClickUp(entrada({ soPrincipal: true }));
    const e = entregar(s.abas, s.esperado, "csv", NOME_ABA_PRINCIPAL);
    expect(e.extensao).toBe("csv");
    const texto = e.buffer.toString("utf8");
    expect(texto.charCodeAt(0)).toBe(0xfeff); // BOM: o Excel abre os acentos certos
    const csv = lerCsv(texto);
    expect(csv[0]).toEqual(COLUNAS_COMPOSICAO.map((c) => c.titulo));
    expect(csv).toHaveLength(1 + s.linhasComposicao);
    const iv = csv[0]!.indexOf("Valor atribuído ao vínculo");
    const soma = sum(csv.slice(1).map((r) => r[iv]!.replace(",", ".")));
    expect(toAmountString(soma)).toBe(TOTAL_ATIVOS);
    expect(csv.slice(1).some((r) => r[iv] === "26,25")).toBe(true);
    expect(csv.slice(1).some((r) => r[csv[0]!.indexOf("Data Crédito")] === "20/10/2026")).toBe(true);
    // o campo com ';' (vários itens) sobrevive entre aspas
    expect(csv.some((r) => r.includes("[SEAWAY] - Sala 09 (48,75); [SEAWAY] - Sala 10 (48,75)"))).toBe(true);
    // a coluna de ID de fatura é número cru, nunca "27.320"
    expect(csv.slice(1).some((r) => r[csv[0]!.indexOf("ID Fatura")] === "27320")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Texto hostil e as colunas
// ---------------------------------------------------------------------------------------------------------------

describe("texto hostil (campos livres vindos do Conexa e do ClickUp)", () => {
  const hostil = 'Cliente & <Filhos> "Ltda" \'x\' \u0008\u0001 fim';
  const L_HOSTIL = linhaComp({
    crConexaId: 777,
    valorRecebidoCat: "10.00",
    razaoSocial: hostil,
    servicoOuPlano: "x".repeat(40_000), // passa do limite de uma célula do Excel
    itensAtribuidos: [{ servicoItem: "=HYPERLINK(\"http://evil\",\"x\")", valor: "10.00" }],
    modo: "por-item",
  });
  const cenarioHostil = (soPrincipal: boolean) => {
    const v = vinculo({ id: "vh", categoria: CAT_FISCAL, clickUpTaskId: "0123", padroes: ["=1+1", "<b>x</b>"], ultimoEnvio: envio("vh", { sucesso: false, erro: "falha <script>alert(1)</script> & \u0000 ok" }) });
    return montarAbasClickUp(
      entrada({
        vinculos: [v],
        composicoes: [comp(v, [L_HOSTIL])],
        envios: [envio("vh", { sucesso: false, erro: "falha <script>alert(1)</script> & \u0000 ok" })],
        soPrincipal,
      }),
    );
  };

  it("xlsx: caracteres de controle somem, o resto é escapado, o limite da célula é marcado e o arquivo continua conferindo", () => {
    const s = cenarioHostil(false);
    const e = entregar(s.abas, s.esperado, "xlsx", NOME_ABA_PRINCIPAL);
    const linhas = lerAba(e.buffer, NOME_ABA_PRINCIPAL).linhas;
    const r = dados(linhas)[0]!;
    expect(r[indice(linhas, "Cliente")]).toBe(textoSeguro(hostil));
    expect(r[indice(linhas, "Cliente")]).toBe('Cliente & <Filhos> "Ltda" \'x\'  fim');
    const servico = r[indice(linhas, "Serviço/Plano (Conexa)")]!;
    expect(servico.length).toBeLessThanOrEqual(32_000);
    expect(servico).toMatch(/texto cortado/);
    expect(r[indice(linhas, "Itens atribuídos a este vínculo")]).toBe('=HYPERLINK("http://evil","x") (10,00)');
    // id de tarefa numérico com zero à esquerda continua TEXTO — no XML, não só na leitura (o Excel mostraria "123")
    expect(r[indice(linhas, "Tarefa ClickUp")]).toBe("0123");
    const xml = lerXml(e.buffer, "xl/worksheets/sheet1.xml"); // Composição é a 1ª aba
    expect(xml).toContain('<is><t xml:space="preserve">0123</t></is>');
    expect(xml).not.toContain("<v>0123</v>");

    const env = lida(s.abas, "Envios");
    expect(env[1]![indice(env, "Erro")]).toBe("falha <script>alert(1)</script> &  ok");
    const vinc = lida(s.abas, "Vínculos");
    expect(vinc[1]![indice(vinc, "Padrões (qualquer um casa)")]).toBe("=1+1 | <b>x</b>");
    expect(vinc[1]![indice(vinc, "Último envio: erro")]).toBe("falha <script>alert(1)</script> &  ok");
  });

  it("Leia-me: nome de quem exporta, categoria e frase de atualidade também são higienizados (a aba não usa a limpeza da tabela)", () => {
    const sujo = "Cat \u0008 estranha";
    const v = vinculo({ id: "vl", categoria: sujo, clickUpTaskId: "tl" });
    const s = montarAbasClickUp(
      entrada({
        pedido: { ...PEDIDO, categorias: [sujo] },
        vinculos: [v],
        composicoes: [comp(v, [])],
        envios: [],
        usuario: { ...ADMIN, nome: "Admin \u0001 Silva", email: "a\u0000@t" },
        frescor: { texto: "Parada \u0008 por <erro> & cia", alerta: true },
      }),
    );
    const e = entregar(s.abas, s.esperado, "xlsx", NOME_ABA_PRINCIPAL); // o arquivo abre e confere
    const leia = lerAba(e.buffer, "Leia-me").linhas.map((r) => r.join(" | ")).join("\n");
    expect(leia).toContain("Gerado por | Admin  Silva (a@t)");
    expect(leia).toContain("Categoria | Cat  estranha");
    expect(leia).toContain("ATENÇÃO | Parada  por <erro> & cia");
    // e nenhuma das três primeiras abas (Leia-me, Vínculos, Composição) carrega caractere de controle inválido em XML
    for (const parte of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]) {
      expect(lerXml(e.buffer, parte), parte).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    }
  });

  it("csv: texto que começa com = + - @ ganha apóstrofo (nunca vira fórmula no Excel/Sheets)", () => {
    const perigosos = ["=SOMA(A1)", "+1", "-1+1", "@cmd", '=HYPERLINK("http://evil","x")'];
    const v = vinculo({ id: "vp", categoria: CAT_FISCAL, clickUpTaskId: "tp" });
    const linhasPerigosas = perigosos.map((p, i) => linhaComp({ crConexaId: 800 + i, valorRecebidoCat: "1.00", razaoSocial: p }));
    const s = montarAbasClickUp(entrada({ vinculos: [v], composicoes: [comp(v, linhasPerigosas)], envios: [], soPrincipal: true }));
    const e = entregar(s.abas, s.esperado, "csv", NOME_ABA_PRINCIPAL);
    const csv = lerCsv(e.buffer.toString("utf8"));
    const clientes = csv.slice(1).map((r) => r[csv[0]!.indexOf("Cliente")]);
    expect(clientes.sort()).toEqual(perigosos.map((p) => `'${p}`).sort());
  });
});

describe("colunas da Composição", () => {
  const completa: LinhaDaPlanilha = {
    categoria: "C", tarefa: "t", vinculoAtivo: true, crConexaId: 1, cliente: "Cli", servico: "S", dataCredito: dia("2026-10-15"),
    valorLinha: "10.00", valorAtribuido: "5.00", modo: "por-item", dividida: true, itens: "i", proporcionado: "S", revisada: true, alerta: "a",
  };

  it("cada coluna lê SÓ os campos que declara — e todos eles (o Proxy acusa qualquer leitura fora do declarado)", () => {
    for (const coluna of COLUNAS_COMPOSICAO) {
      const lidos = new Set<string>();
      const p = new Proxy(completa, {
        get(alvo, prop) {
          lidos.add(String(prop));
          return (alvo as unknown as Record<string, unknown>)[String(prop)];
        },
      });
      coluna.valor(p);
      expect([...lidos].sort(), coluna.id).toEqual([...coluna.campos].sort());
      for (const campo of coluna.campos) expect(Object.keys(completa), `${coluna.id} → ${campo}`).toContain(campo);
    }
  });

  it("títulos e ids únicos; uma única coluna soma ('Valor atribuído'); a outra de dinheiro avisa que NÃO soma", () => {
    expect(new Set(COLUNAS_COMPOSICAO.map((c) => c.titulo)).size).toBe(COLUNAS_COMPOSICAO.length);
    expect(new Set(COLUNAS_COMPOSICAO.map((c) => c.id)).size).toBe(COLUNAS_COMPOSICAO.length);
    const dinheiro = COLUNAS_COMPOSICAO.filter((c) => c.tipo === "dinheiro");
    expect(dinheiro.map((c) => c.titulo)).toEqual(["Valor da linha (Cat.) — NÃO somar", "Valor atribuído ao vínculo"]);
    expect(montarAbasClickUp(entrada()).detalhe.indiceColunaTotal).toBe(COLUNAS_COMPOSICAO.findIndex((c) => c.id === "valorAtribuido"));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Orquestração do servidor (gerarExportacaoClickUp) com Prisma e composição simulados
// ---------------------------------------------------------------------------------------------------------------

describe("gerarExportacaoClickUp (orquestração; banco e composição simulados)", () => {
  const T0 = new Date("2026-11-01T10:00:00Z");
  const PEDIDO_OUT: PedidoClickUp = { ano: 2026, mes: 10, categorias: [], somenteAtivos: true };

  const fv = (id: string, p: Partial<FakeVinculo> = {}): FakeVinculo => ({
    id,
    categoria: CAT_FISCAL,
    padroes: ["Batial"],
    clickUpListId: "L1",
    clickUpTaskId: `t${id}`,
    ativo: true,
    criadoPorId: null,
    criadoPorNome: "Duda",
    criadoEm: new Date("2026-01-10T12:30:00Z"),
    atualizadoEm: T0,
    ...p,
  });
  const fl = (id: string, fatura: number, categoria: string, data: string, valor: string): FakeLinha => ({
    id,
    crConexaId: fatura,
    categoria,
    dataCredito: dia(data),
    valorRecebidoCat: valor,
    atualizadoEm: T0,
  });
  const daLinha = (l: FakeLinha): LinhaDaComposicao => ({
    id: l.id,
    crConexaId: l.crConexaId,
    razaoSocial: "Cliente",
    servicoOuPlano: "Endereço Fiscal Batial Mensal",
    dataCredito: l.dataCredito!.toISOString(),
    valorRecebidoCat: l.valorRecebidoCat,
    valorAtribuido: l.valorRecebidoCat,
    modo: "linha-inteira",
    dividida: false,
    proporcionado: "N",
    revisadoManualmente: false,
  });
  const linhaDoBanco = (id: string): FakeLinha => h.db.linhas.find((l) => l.id === id)!;
  const vinculoDoBanco = (id: string): FakeVinculo => h.db.vinculos.find((v) => v.id === id)!;

  let roteiro: Record<string, { incluidas: LinhaDaComposicao[]; excluidas?: LinhaExcluidaDaComposicao[] }>;
  const respostaDo = (v: { id: string }) => {
    const r = roteiro[v.id] ?? { incluidas: [] };
    return { incluidas: r.incluidas, excluidas: r.excluidas ?? [], total: sum(r.incluidas.map((l) => l.valorAtribuido)) };
  };
  const chamadaDe = (id: string) =>
    h.compor.mock.calls.find((c) => (c[0] as { id: string }).id === id) as [{ id: string }, Array<{ id: string }>, Date, Date] | undefined;

  beforeEach(() => {
    h.db.vinculos = [fv("va"), fv("vb", { ativo: false, padroes: ["Litoral"] }), fv("vc", { categoria: CAT_SEBRAE, padroes: ["Sala 08"] })];
    h.db.linhas = [
      fl("l1", 11, CAT_FISCAL, "2026-10-05", "100.10"),
      fl("l2", 12, CAT_FISCAL, "2026-10-20", "50.00"),
      fl("l3", 13, CAT_SEBRAE, "2026-10-10", "75.00"),
      fl("l4", 14, CAT_FISCAL, "2026-09-30", "9.99"), // fora do mês
    ];
    h.db.envios = [{ id: "e1", vinculoId: "va", ano: 2026, mes: 10, valorEnviado: "150.10", sucesso: true, erro: null, enviadoEm: new Date("2026-11-03T12:00:00Z") }];
    h.db.transacoes = 0;
    h.db.opcoesDaTransacao = [];
    h.db.leiturasDeEnvios = 0;
    h.db.contagemDeEnviosForcada = null;
    roteiro = {
      va: { incluidas: [daLinha(linhaDoBanco("l1")), daLinha(linhaDoBanco("l2"))] },
      vb: { incluidas: [daLinha(linhaDoBanco("l1"))] }, // hipotético: o inativo "levaria" a mesma linha do va
      vc: { incluidas: [daLinha(linhaDoBanco("l3"))] },
    };
    h.compor.mockReset();
    h.compor.mockImplementation(async (v: { id: string }) => respostaDo(v));
  });

  it("caminho feliz: composição pela MESMA chamada do envio, leitura numa transação REPEATABLE READ, arquivo conferido", async () => {
    const r = await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx");
    expect(r.linhas).toBe(3);
    expect(r.total).toBe("225.10"); // 100,10 + 50,00 + 75,00
    expect(r.nomeArquivo).toBe("ClickUp_composicao_2026-10.xlsx");
    expect(r.dadosPessoais).toBe(false);
    expect(r.filtrosJson).toEqual(PEDIDO_OUT);
    expect(r.filtros[0]).toEqual(["Mês de apuração (Data de Crédito)", "Outubro de 2026"]);
    expect(nomesDasAbas(r.buffer)).toEqual(["Composição", "Vínculos", "Resumo por vínculo", "Excluídas", "Envios", "Leia-me"]);

    // a vizinhança do envio: só vínculos ATIVOS da MESMA categoria disputam linhas; o inativo vb não é concorrente do va
    expect(h.compor).toHaveBeenCalledTimes(2);
    expect(chamadaDe("va")![1]).toEqual([]);
    expect(chamadaDe("vc")![1]).toEqual([]);
    expect(chamadaDe("vb")).toBeUndefined();
    // e os limites do mês são os do envio (limitesDoMes)
    expect(chamadaDe("va")![2].toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(chamadaDe("va")![3].toISOString()).toBe("2026-11-01T00:00:00.000Z");

    expect(h.db.transacoes).toBe(1);
    expect(h.db.opcoesDaTransacao[0]).toMatchObject({ isolationLevel: "RepeatableRead" });

    const resumo = lerAba(r.buffer, "Resumo por vínculo").linhas;
    const va = dados(resumo).find((x) => x[indice(resumo, "Tarefa ClickUp")] === "tva")!;
    expect(va[indice(resumo, "Total atribuído (o que o painel envia)")]).toBe("150.10");
    expect(va[indice(resumo, "Situação")]).toBe("Conciliado com o último envio");
  });

  it("somenteAtivos desmarcado: o inativo também é composto, contra os vizinhos ATIVOS — e nunca é concorrente de um ativo", async () => {
    const r = await gerarExportacaoClickUp({ ...PEDIDO_OUT, somenteAtivos: false }, ADMIN, "xlsx");
    expect(h.compor).toHaveBeenCalledTimes(3);
    expect(chamadaDe("vb")![1].map((o) => o.id)).toEqual(["va"]);
    expect(chamadaDe("va")![1]).toEqual([]);
    expect(r.total).toBe("325.20"); // 225,10 + os 100,10 hipotéticos do inativo
    expect(r.nomeArquivo).toBe("ClickUp_composicao_2026-10_com_inativos.xlsx");
  });

  it("filtro de categoria: só os vínculos dela são compostos", async () => {
    const r = await gerarExportacaoClickUp({ ...PEDIDO_OUT, categorias: [CAT_SEBRAE] }, ADMIN, "xlsx");
    expect(h.compor).toHaveBeenCalledTimes(1);
    expect(chamadaDe("vc")).toBeDefined();
    expect(r.total).toBe("75.00");
    expect(r.nomeArquivo).toBe("ClickUp_composicao_2026-10_filtrado.xlsx");
    const vinc = lerAba(r.buffer, "Vínculos").linhas;
    expect(dados(vinc).map((x) => x[indice(vinc, "Tarefa ClickUp")])).toEqual(["tvc"]);
  });

  it("quem não é administrador é recusado ANTES de qualquer leitura", async () => {
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, VIEWER, "xlsx")).rejects.toThrow(ExportacaoNegadaError);
    expect(h.compor).not.toHaveBeenCalled();
    expect(h.db.transacoes).toBe(0);
  });

  it("categoria sem vínculo é erro de pedido (400), sem calcular nada", async () => {
    const pedido: PedidoClickUp = { ...PEDIDO_OUT, categorias: [CAT_FISCAL, "Inexistente"] };
    await expect(gerarExportacaoClickUp(pedido, ADMIN, "xlsx")).rejects.toThrow(ExportacaoInvalidaError);
    await expect(gerarExportacaoClickUp(pedido, ADMIN, "xlsx")).rejects.toThrow(/"Inexistente"/);
    expect(h.compor).not.toHaveBeenCalled();
  });

  it("ano ou mês fora do calendário no pedido (montado fora de lerPedidoClickUp) também é recusado", async () => {
    await expect(gerarExportacaoClickUp({ ...PEDIDO_OUT, mes: 13 }, ADMIN)).rejects.toThrow(ExportacaoInvalidaError);
    await expect(gerarExportacaoClickUp({ ...PEDIDO_OUT, mes: 0 }, ADMIN)).rejects.toThrow(ExportacaoInvalidaError);
    await expect(gerarExportacaoClickUp({ ...PEDIDO_OUT, ano: 1999 }, ADMIN)).rejects.toThrow(ExportacaoInvalidaError);
    await expect(gerarExportacaoClickUp({ ...PEDIDO_OUT, mes: 1.5 }, ADMIN)).rejects.toThrow(ExportacaoInvalidaError);
    expect(h.compor).not.toHaveBeenCalled();
  });

  it("uma sincronização que grava NO MEIO da composição faz REFAZER (não entrega mistura de dois instantes)", async () => {
    let primeira = true;
    h.compor.mockImplementation(async (v: { id: string }) => {
      if (primeira) {
        primeira = false;
        linhaDoBanco("l1").atualizadoEm = new Date("2026-11-04T12:00:00Z"); // a sincronização gravou aqui
      }
      return respostaDo(v);
    });
    const r = await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx");
    expect(r.total).toBe("225.10");
    expect(h.compor).toHaveBeenCalledTimes(4); // 2 vínculos × 2 tentativas
    expect(h.db.transacoes).toBe(2);
  });

  it("um vínculo editado no meio (ativado, padrões trocados) também faz refazer", async () => {
    let primeira = true;
    h.compor.mockImplementation(async (v: { id: string }) => {
      if (primeira) {
        primeira = false;
        vinculoDoBanco("vc").atualizadoEm = new Date("2026-11-04T12:00:00Z");
      }
      return respostaDo(v);
    });
    await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx");
    expect(h.compor).toHaveBeenCalledTimes(4);
    expect(h.db.transacoes).toBe(2);
  });

  it("deriva que NÃO para: desiste na 3ª tentativa com a explicação, sem arquivo", async () => {
    let n = 0;
    h.compor.mockImplementation(async (v: { id: string }) => {
      n += 1;
      linhaDoBanco("l1").atualizadoEm = new Date(T0.getTime() + n * 1000);
      return respostaDo(v);
    });
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/mudaram enquanto a exportação era montada \(3 tentativas\).*não foi entregue/);
    expect(h.compor).toHaveBeenCalledTimes(6);
    expect(h.db.transacoes).toBe(3);
  });

  it("composição que diz uma coisa e o banco outra (sem deriva) é ERRO — sem retry e sem arquivo", async () => {
    linhaDoBanco("l2").valorRecebidoCat = "50.01"; // o roteiro continua dizendo 50,00
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/Conferência com o banco não fechou.*vale 50\.00 na planilha e 50\.01 no banco/);
    expect(h.compor).toHaveBeenCalledTimes(2); // nada de nova tentativa: não houve deriva
    expect(h.db.transacoes).toBe(1);
  });

  it("linha citada pela composição que o banco não tem é ERRO", async () => {
    h.db.linhas = h.db.linhas.filter((l) => l.id !== "l2");
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/a linha l2 não existe mais no banco/);
  });

  it("vínculo sem padrão vira vínculo MARCADO no Resumo (a exportação não aborta por causa de um)", async () => {
    vinculoDoBanco("va").padroes = [];
    h.compor.mockImplementation(async (v: { id: string }) => {
      if (v.id === "va") throw new PadroesVazioError("Vínculo sem nenhum padrão — não há o que casar.");
      return respostaDo(v);
    });
    const r = await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx");
    expect(r.total).toBe("75.00"); // só o vc entra nas somas
    const resumo = lerAba(r.buffer, "Resumo por vínculo").linhas;
    const va = dados(resumo).find((x) => x[indice(resumo, "Tarefa ClickUp")] === "tva")!;
    expect(va[indice(resumo, "Situação")]).toMatch(/^NÃO CALCULADO: Vínculo sem nenhum padrão — não há o que casar\. \(vínculo\(s\) ativo\(s\) sem padrão nesta categoria: tva\)/);
    expect(va[indice(resumo, "Total atribuído (o que o painel envia)")]).toBe("");
    expect(lerAba(r.buffer, "Leia-me").linhas.flat().join(" ")).toMatch(/NÃO tiveram a composição calculada/);
  });

  it("qualquer OUTRO erro da composição (banco fora do ar…) PROPAGA: nada de arquivo parcial", async () => {
    h.compor.mockImplementation(async () => {
      throw new Error("conexão com o banco caiu");
    });
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow("conexão com o banco caiu");
  });

  it("padrões gravados num formato inválido no banco: erro explícito, sem calcular", async () => {
    vinculoDoBanco("va").padroes = { naoE: "uma lista" };
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/tem os padrões gravados num formato inválido/);
    expect(h.compor).not.toHaveBeenCalled();
  });

  it("tetos: composição, aba Excluídas (só .xlsx) e aba Envios (só .xlsx) viram ExportacaoGrandeDemaisError com o que fazer", async () => {
    const muitas = (n: number) => Array.from({ length: n }, (_, i) => linhaComp({ crConexaId: 50_000 + i, valorRecebidoCat: "1.00" }));

    roteiro.va = { incluidas: muitas(MAX_LINHAS + 1) };
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(ExportacaoGrandeDemaisError);
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "csv")).rejects.toThrow(/Filtre por categoria/);

    roteiro.va = { incluidas: [], excluidas: muitas(MAX_LINHAS + 1).map((l) => excluida(l, "tx")) };
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/aba Excluídas teria mais de 20\.000 linhas/);

    roteiro.va = { incluidas: [daLinha(linhaDoBanco("l1")), daLinha(linhaDoBanco("l2"))] };
    h.db.contagemDeEnviosForcada = MAX_LINHAS + 1;
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx")).rejects.toThrow(/aba Envios teria 20\.001 linhas/);
    // o CSV não leva a aba Envios: o teto dela não o atinge
    await expect(gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "csv")).resolves.toMatchObject({ linhas: 3 });
  });

  it("CSV: só a Composição, e o log de envios nem é lido", async () => {
    const r = await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "csv");
    expect(r.contentType).toMatch(/^text\/csv/);
    expect(r.nomeArquivo).toBe("ClickUp_composicao_2026-10.csv");
    expect(r.linhas).toBe(3);
    const csv = lerCsv(r.buffer.toString("utf8"));
    expect(csv).toHaveLength(4);
    expect(csv[0]).toEqual(COLUNAS_COMPOSICAO.map((c) => c.titulo));
    expect(h.db.leiturasDeEnvios).toBe(0);
  });

  it("recorte sem nenhuma linha: o arquivo sai, com total zero (não é erro)", async () => {
    roteiro = {};
    const r = await gerarExportacaoClickUp(PEDIDO_OUT, ADMIN, "xlsx");
    expect(r.linhas).toBe(0);
    expect(r.total).toBe("0.00");
    expect(lerAba(r.buffer, "Composição").linhas.find((x) => x[0] === "TOTAL")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Travas estáticas: SÓ LEITURA e NUNCA o ClickUp
// ---------------------------------------------------------------------------------------------------------------

describe("só leitura e nunca o ClickUp (trava estática do código-fonte)", () => {
  const fonte = (relativo: string): string => readFileSync(new URL(relativo, import.meta.url), "utf8");
  const ARQUIVOS: Array<[string, string]> = [
    ["clickup.ts", "./clickup.ts"],
    ["pasta-clickup.ts", "./pasta-clickup.ts"],
    ["painel-clickup.tsx", "../../app/(dashboard)/exportar/painel-clickup.tsx"],
  ];

  it.each(ARQUIVOS)("%s não importa o envio (push), as ações nem o cliente HTTP do ClickUp", (_nome, caminho) => {
    const src = fonte(caminho);
    expect(src).not.toMatch(/from\s+["']@\/lib\/clickup\/(push|client|actions)["']/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/pushVinculoAgora|pushValoresDoMesCorrente|setTaskFieldValue/);
  });

  it.each(ARQUIVOS)("%s não escreve no banco (nada de create/update/upsert/delete nem SQL cru)", (_nome, caminho) => {
    const src = fonte(caminho);
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(src).not.toMatch(/\$(executeRaw|queryRaw|executeRawUnsafe|queryRawUnsafe)/);
  });

  it("a trava funciona: um código que escreve ou chama o envio É acusado", () => {
    expect("await prisma.clickUpPushLog.create({ data })").toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect('import { pushVinculoAgora } from "@/lib/clickup/push";').toMatch(/from\s+["']@\/lib\/clickup\/(push|client|actions)["']/);
  });
});
