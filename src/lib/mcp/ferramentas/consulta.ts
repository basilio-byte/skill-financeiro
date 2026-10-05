import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEnv, hasConexaApiToken, hasConexaWebCredentials } from "@/lib/env";
import { getPeriodBounds, keyToUtcDate, nowInAppTz, todayKey, type PeriodKind } from "@/lib/dates";
import { buildOverview } from "@/lib/reports/overview";
import { buildMetas } from "@/lib/metas/metas";
import { listarConflitos } from "@/lib/categorization/conflitos";
import { consultarInadimplencia } from "@/lib/inadimplencia/consulta";
import { lerFiltros } from "@/lib/inadimplencia/dominio";
import { diagnosticarReceita } from "@/lib/mcp/diagnostico";
import { ferramenta, type Ferramenta } from "../tipos";
import { dataIso, din, iso, limite, paraData } from "./comum";

/**
 * FERRAMENTAS DE CONSULTA — todas somente leitura (ADR-0033).
 *
 * Regra de ouro de TODAS: elas leem o BANCO do painel, não o Conexa ao vivo. Se a
 * sincronização está parada, o que elas devolvem é um retrato antigo — e é por isso
 * que `estado_do_sistema` existe e que as instruções do servidor mandam chamá-la
 * primeiro.
 */

const KINDS = ["day", "week", "month", "quarter", "semester", "year"] as const;

// ---------------------------------------------------------------------------
// Estado e saúde
// ---------------------------------------------------------------------------

const estadoDoSistema = ferramenta({
  nome: "estado_do_sistema",
  titulo: "Estado do sistema",
  descricao:
    "O PRIMEIRO que você deve chamar. Diz se a sincronização de receita está saudável ou PARADA (e a causa provável), quando foi a última rodada concluída, o que há no banco por mês de crédito, o estado da inadimplência e quais interruptores estão ligados. " +
    "Use antes de afirmar qualquer total: com a receita parada, os números são um retrato antigo. NÃO consulta o Conexa; mostra o que o painel registrou.",
  entrada: z.object({}),
  somenteLeitura: true,
  executar: async () => {
    const agora = new Date();
    const env = getEnv();

    const [rodadasRecentes, ultimaDone, totalLinhas, porMes, inad, inadAgg, tokensAtivos, ultimasChamadas, regras] = await Promise.all([
      prisma.revenueSyncRun.findMany({
        orderBy: { iniciadoEm: "desc" },
        take: 40,
        select: { id: true, status: true, origem: true, erro: true, iniciadoEm: true, concluidoEm: true, periodoInicio: true, periodoFim: true, totalRecebido: true, diferencaConferencia: true },
      }),
      // A última CONCLUÍDA é buscada à parte: com a receita parada, a janela das mais recentes é
      // toda de falhas e esconderia a única informação que importa — quando foi a última boa.
      prisma.revenueSyncRun.findFirst({
        where: { status: "DONE" },
        orderBy: { iniciadoEm: "desc" },
        select: { id: true, status: true, origem: true, erro: true, iniciadoEm: true, concluidoEm: true, periodoInicio: true, periodoFim: true, totalRecebido: true, diferencaConferencia: true },
      }),
      prisma.revenueCategorizedLine.count(),
      prisma.revenueCategorizedLine.groupBy({
        by: ["mesCredito"],
        _sum: { valorRecebidoCat: true },
        _count: { _all: true },
        orderBy: { mesCredito: "desc" },
        take: 4,
      }),
      prisma.inadimplenciaSyncRun.findFirst({ orderBy: { iniciadoEm: "desc" } }),
      prisma.cobrancaEmAberto.aggregate({ _sum: { valor: true }, _count: { _all: true } }),
      prisma.tokenMcp.count({ where: { revogadoEm: null } }),
      prisma.auditoriaMcp.findMany({ orderBy: { quando: "desc" }, take: 3, select: { quando: true, quem: true, ferramenta: true, resultado: true } }),
      prisma.revenueCategoryRule.count({ where: { ativo: true } }),
    ]);

    const rodadas = ultimaDone && !rodadasRecentes.some((r) => r.id === ultimaDone.id) ? [...rodadasRecentes, ultimaDone] : rodadasRecentes;
    // Falhas desde a última concluída, contadas no banco (a janela acima é limitada).
    const falhasReais = await prisma.revenueSyncRun.count({
      where: { status: "FAILED", ...(ultimaDone ? { iniciadoEm: { gt: ultimaDone.iniciadoEm } } : {}) },
    });
    const diag = diagnosticarReceita(rodadas, agora, falhasReais);
    return {
      agoraUtc: agora.toISOString(),
      receita: {
        diagnostico: diag,
        ultimasRodadas: rodadasRecentes.slice(0, 8).map((r) => ({
          id: r.id,
          status: r.status,
          origem: r.origem,
          periodo: `${iso(r.periodoInicio)}..${iso(r.periodoFim)}`,
          iniciadoEm: r.iniciadoEm,
          totalRecebido: din(r.totalRecebido),
          diferencaConferencia: din(r.diferencaConferencia),
          erro: r.erro ? r.erro.slice(0, 240) : null,
        })),
        linhasNoBanco: totalLinhas,
        porMesDeCredito: porMes.map((m) => ({ mes: m.mesCredito, linhas: m._count._all, total: din(m._sum.valorRecebidoCat) })),
        regrasAtivas: regras,
      },
      inadimplencia: {
        ultimaSincronizacao: inad
          ? { quando: inad.concluidoEm ?? inad.iniciadoEm, status: inad.status, erro: inad.erro?.slice(0, 240) ?? null, total: inad.total }
          : null,
        noEspelho: { cobrancas: inadAgg._count._all, valor: din(inadAgg._sum.valor) },
      },
      configuracao: {
        sincronizacaoAutomatica: env.SYNC_AUTO_ENABLED,
        intervaloMinutos: env.SYNC_INTERVAL_MINUTES,
        carenciaDias: env.SYNC_CARENCIA_DIAS,
        inadimplenciaLigada: env.INADIMPLENTES_SYNC_ENABLED,
        temCredencialWebConexa: hasConexaWebCredentials(),
        temTokenApiConexa: hasConexaApiToken(),
        mcpSomenteLeitura: env.MCP_SOMENTE_LEITURA === "on",
      },
      mcp: { tokensAtivos, ultimasChamadas },
    };
  },
});

const listarRodadas = ferramenta({
  nome: "listar_rodadas",
  titulo: "Listar rodadas de sincronização",
  descricao:
    "Histórico das rodadas de sincronização de receita (período, status, origem, total, conferência, erro). Use para investigar quando algo começou a falhar. Para ver UMA rodada inteira (resumo por categoria), use detalhar_rodada. O total de uma rodada é o que ELA calculou na hora — pode não bater com o Panorama atual.",
  entrada: z.object({
    status: z.enum(["DONE", "FAILED", "RUNNING"]).optional(),
    origem: z.enum(["MANUAL", "AUTOMATICO"]).optional(),
    desde: dataIso.optional().describe("Só rodadas iniciadas a partir desta data."),
    limite: limite(100, 20),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const rows = await prisma.revenueSyncRun.findMany({
      where: {
        ...(a.status ? { status: a.status } : {}),
        ...(a.origem ? { origem: a.origem } : {}),
        ...(a.desde ? { iniciadoEm: { gte: paraData(a.desde) } } : {}),
      },
      orderBy: { iniciadoEm: "desc" },
      take: a.limite,
    });
    return {
      total: rows.length,
      rodadas: rows.map((r) => ({
        id: r.id,
        status: r.status,
        origem: r.origem,
        periodo: `${iso(r.periodoInicio)}..${iso(r.periodoFim)}`,
        iniciadoEm: r.iniciadoEm,
        concluidoEm: r.concluidoEm,
        linhasCR: r.totalLinhasCR,
        totalRecebido: din(r.totalRecebido),
        diferencaConferencia: din(r.diferencaConferencia),
        novas: r.totalLinhasNovas,
        atualizadas: r.totalLinhasAtualizadas,
        orfasPreservadas: r.totalLinhasOrfasPreservadas,
        faturasComConflito: r.totalFaturasComConflito,
        erro: r.erro,
      })),
    };
  },
});

const detalharRodada = ferramenta({
  nome: "detalhar_rodada",
  titulo: "Detalhar uma rodada",
  descricao: "Uma rodada de sincronização completa, com o resumo por categoria que ela calculou e o erro integral, se houve.",
  entrada: z.object({ id: z.string().min(1) }),
  somenteLeitura: true,
  executar: async ({ id }) => {
    const r = await prisma.revenueSyncRun.findUnique({ where: { id } });
    if (!r) throw new Error(`Rodada ${id} não encontrada.`);
    return { ...r, periodoInicio: iso(r.periodoInicio), periodoFim: iso(r.periodoFim) };
  },
});

// ---------------------------------------------------------------------------
// Receita
// ---------------------------------------------------------------------------

const panorama = ferramenta({
  nome: "panorama",
  titulo: "Panorama de receita",
  descricao:
    "O mesmo que a tela Panorama: total recebido no período por Data de Crédito, por categoria, por conta, por confiança do rateio, a tendência dos últimos 12 períodos e as últimas rodadas. " +
    "Use para a pergunta 'quanto entrou em X?'. ⚠ Confira estado_do_sistema antes: com a receita parada, é um retrato antigo. Para recortes que o Panorama não faz (por unidade, por dia, filtrando categoria), use agregar_receita.",
  entrada: z.object({
    granularidade: z.enum(KINDS).default("month").describe("day | week | month | quarter | semester | year."),
    referencia: dataIso.optional().describe("Qualquer dia dentro do período desejado. Padrão: hoje."),
  }),
  somenteLeitura: true,
  executar: async ({ granularidade, referencia }) => {
    if (referencia) paraData(referencia);
    return buildOverview(granularidade as PeriodKind, referencia);
  },
});

const AGRUPAR = ["categoria", "conta", "unidade", "mesCredito", "dia", "proporcionado", "revisada", "status"] as const;

const agregarReceita = ferramenta({
  nome: "agregar_receita",
  titulo: "Agregar receita",
  descricao:
    "Soma e conta as linhas de receita de um intervalo de Data de Crédito, agrupando por categoria, conta, unidade, mês de crédito, dia, tipo de rateio, revisada ou status. Filtros opcionais por categoria/conta/unidade. " +
    "Use para recortes que o panorama não faz. Cada linha é um bucket de categoria dentro de uma fatura: 'linhas' não é o número de faturas. Valores são strings decimais.",
  entrada: z.object({
    de: dataIso.describe("Data de Crédito inicial (inclusive)."),
    ate: dataIso.describe("Data de Crédito final (inclusive)."),
    agruparPor: z.enum(AGRUPAR),
    categoria: z.string().optional(),
    conta: z.string().optional(),
    unidade: z.string().optional(),
    limite: limite(500, 100),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const de = paraData(a.de);
    const ate = paraData(a.ate);
    if (de > ate) throw new Error("`de` não pode ser depois de `ate`.");
    const where: Prisma.RevenueCategorizedLineWhereInput = {
      dataCredito: { gte: de, lte: ate },
      ...(a.categoria ? { categoria: a.categoria } : {}),
      ...(a.conta ? { conta: a.conta } : {}),
      ...(a.unidade ? { unidade: a.unidade } : {}),
    };
    const campo = { categoria: "categoria", conta: "conta", unidade: "unidade", mesCredito: "mesCredito", dia: "dataCredito", proporcionado: "proporcionado", revisada: "revisadoManualmente", status: "status" }[a.agruparPor] as
      | "categoria" | "conta" | "unidade" | "mesCredito" | "dataCredito" | "proporcionado" | "revisadoManualmente" | "status";

    const [grupos, geral] = await Promise.all([
      prisma.revenueCategorizedLine.groupBy({
        by: [campo],
        where,
        _sum: { valorRecebidoCat: true },
        _count: { _all: true },
        orderBy: { _sum: { valorRecebidoCat: "desc" } },
        take: a.limite,
      }),
      prisma.revenueCategorizedLine.aggregate({ where, _sum: { valorRecebidoCat: true }, _count: { _all: true } }),
    ]);
    return {
      intervalo: `${a.de}..${a.ate}`,
      agruparPor: a.agruparPor,
      total: din(geral._sum.valorRecebidoCat) ?? "0.00",
      linhas: geral._count._all,
      grupos: grupos.map((g) => ({
        chave: campo === "dataCredito" ? iso(g.dataCredito as Date | null) : String((g as Record<string, unknown>)[campo] ?? "(vazio)"),
        total: din((g._sum as { valorRecebidoCat: Prisma.Decimal | null }).valorRecebidoCat),
        linhas: (g._count as { _all: number })._all,
      })),
      mostrandoTodos: grupos.length < a.limite,
    };
  },
});

const buscarLinhas = ferramenta({
  nome: "buscar_linhas",
  titulo: "Buscar linhas de receita",
  descricao:
    "Busca linhas individuais de receita por intervalo de Data de Crédito, fatura (crConexaId), cliente (parte do nome), categoria, serviço/plano, tipo de rateio, revisada e faixa de valor. Paginada. " +
    "Para UMA fatura com tudo (itens, valores originais), use detalhar_fatura. Para somas, use agregar_receita (não some à mão o que esta lista devolve: ela é paginada).",
  entrada: z.object({
    de: dataIso.optional(),
    ate: dataIso.optional(),
    crConexaId: z.number().int().optional(),
    cliente: z.string().min(2).optional().describe("Parte da razão social, sem diferenciar maiúsculas."),
    categoria: z.string().optional(),
    servicoOuPlano: z.string().optional().describe("Parte do nome do serviço ou plano."),
    proporcionado: z.enum(["N", "S", "SEM_LV"]).optional().describe("N = categoria única, S = rateada, SEM_LV = sem item no Listar Vendas."),
    revisada: z.boolean().optional(),
    valorMin: z.number().optional(),
    valorMax: z.number().optional(),
    ordenarPor: z.enum(["valor", "dataCredito"]).default("dataCredito"),
    direcao: z.enum(["asc", "desc"]).default("desc"),
    pagina: z.number().int().min(1).max(1000).default(1),
    limite: limite(200, 50),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const where: Prisma.RevenueCategorizedLineWhereInput = {
      ...(a.de || a.ate ? { dataCredito: { ...(a.de ? { gte: paraData(a.de) } : {}), ...(a.ate ? { lte: paraData(a.ate) } : {}) } } : {}),
      ...(a.crConexaId ? { crConexaId: a.crConexaId } : {}),
      ...(a.cliente ? { razaoSocial: { contains: a.cliente, mode: "insensitive" } } : {}),
      ...(a.categoria ? { categoria: a.categoria } : {}),
      ...(a.servicoOuPlano ? { servicoOuPlano: { contains: a.servicoOuPlano, mode: "insensitive" } } : {}),
      ...(a.proporcionado ? { proporcionado: a.proporcionado } : {}),
      ...(a.revisada !== undefined ? { revisadoManualmente: a.revisada } : {}),
      ...(a.valorMin !== undefined || a.valorMax !== undefined
        ? { valorRecebidoCat: { ...(a.valorMin !== undefined ? { gte: a.valorMin } : {}), ...(a.valorMax !== undefined ? { lte: a.valorMax } : {}) } }
        : {}),
    };
    const [total, linhas] = await Promise.all([
      prisma.revenueCategorizedLine.count({ where }),
      prisma.revenueCategorizedLine.findMany({
        where,
        // Desempate por id: sem ele, valores iguais trocam de lugar entre páginas.
        orderBy: [a.ordenarPor === "valor" ? { valorRecebidoCat: a.direcao } : { dataCredito: a.direcao }, { id: "asc" }],
        skip: (a.pagina - 1) * a.limite,
        take: a.limite,
        select: {
          id: true, crConexaId: true, razaoSocial: true, categoria: true, servicoOuPlano: true, proporcionado: true,
          valorRecebidoCat: true, valorRecebidoTotal: true, dataCredito: true, mesCredito: true, conta: true, unidade: true,
          status: true, parcela: true, revisadoManualmente: true, categoriaOriginal: true, valorRecebidoCatOriginal: true,
        },
      }),
    ]);
    return {
      total,
      pagina: a.pagina,
      totalDePaginas: Math.max(1, Math.ceil(total / a.limite)),
      linhas: linhas.map((l) => ({ ...l, dataCredito: iso(l.dataCredito), valorRecebidoCat: din(l.valorRecebidoCat), valorRecebidoTotal: din(l.valorRecebidoTotal), valorRecebidoCatOriginal: din(l.valorRecebidoCatOriginal) })),
    };
  },
});

const detalharFatura = ferramenta({
  nome: "detalhar_fatura",
  titulo: "Detalhar uma fatura",
  descricao:
    "TODAS as linhas de uma fatura (crConexaId): categorias, meses de crédito, valores, itens do Listar Vendas com o valor rateado de cada um, e o estado de revisão manual. Use para entender por que uma fatura caiu em certa categoria ou por que o total não bate. Com `incluirRaw`, traz também a linha bruta do Conexa (grande).",
  entrada: z.object({ crConexaId: z.number().int(), incluirRaw: z.boolean().default(false) }),
  somenteLeitura: true,
  executar: async ({ crConexaId, incluirRaw }) => {
    const linhas = await prisma.revenueCategorizedLine.findMany({
      where: { crConexaId },
      orderBy: [{ mesCredito: "asc" }, { chaveLinha: "asc" }],
      include: { revisadoPor: { select: { name: true, email: true } } },
    });
    if (linhas.length === 0) throw new Error(`Nenhuma linha para a fatura ${crConexaId}. Ela pode não ter entrado no banco (ver estado_do_sistema).`);
    const somaPorMes = new Map<string, string>();
    for (const l of linhas) {
      const atual = Number(somaPorMes.get(l.mesCredito) ?? 0);
      somaPorMes.set(l.mesCredito, (atual + Number(l.valorRecebidoCat)).toFixed(2));
    }
    return {
      crConexaId,
      linhas: linhas.map((l) => ({
        id: l.id, chaveLinha: l.chaveLinha, categoria: l.categoria, servicoOuPlano: l.servicoOuPlano, proporcionado: l.proporcionado,
        mesCredito: l.mesCredito, dataCredito: iso(l.dataCredito), valorRecebidoCat: din(l.valorRecebidoCat), valorRecebidoTotal: din(l.valorRecebidoTotal),
        ajusteArredondamento: din(l.ajusteArredondamento), itens: l.itensDetalhe, status: l.status, tipo: l.tipo, parcela: l.parcela, conta: l.conta, unidade: l.unidade,
        revisadoManualmente: l.revisadoManualmente, revisadoPor: l.revisadoPor?.email ?? null, revisadoEm: l.revisadoEm,
        categoriaOriginal: l.categoriaOriginal, valorRecebidoCatOriginal: din(l.valorRecebidoCatOriginal), atualizadoEm: l.atualizadoEm,
        ...(incluirRaw ? { raw: l.raw } : {}),
      })),
      somaPorMesDeCredito: Object.fromEntries(somaPorMes),
      cliente: linhas[0]!.razaoSocial,
      observacao: "O valorRecebidoTotal é o de UMA parcela; some as linhas do MESMO mês de crédito para comparar com ele.",
    };
  },
});

const filaDeRevisao = ferramenta({
  nome: "fila_de_revisao",
  titulo: "Fila de revisão",
  descricao:
    "As faturas rateadas (S) ou sem item no Listar Vendas (SEM_LV) que ainda não foram revisadas, como a tela Revisar. Linhas de valor zero ficam de fora. Use para saber o que precisa de olho humano; para corrigir, revisar_linha.",
  entrada: z.object({ incluirRevisadas: z.boolean().default(false), limite: limite(200, 50) }),
  somenteLeitura: true,
  executar: async ({ incluirRevisadas, limite: take }) => {
    const where: Prisma.RevenueCategorizedLineWhereInput = {
      proporcionado: { in: ["S", "SEM_LV"] },
      valorRecebidoCat: { not: 0 },
      ...(incluirRevisadas ? {} : { revisadoManualmente: false }),
    };
    const [total, linhas] = await Promise.all([
      prisma.revenueCategorizedLine.count({ where }),
      prisma.revenueCategorizedLine.findMany({
        where, take, orderBy: [{ valorRecebidoCat: "desc" }, { id: "asc" }],
        select: { id: true, crConexaId: true, razaoSocial: true, servicoOuPlano: true, categoria: true, proporcionado: true, valorRecebidoCat: true, mesCredito: true, revisadoManualmente: true },
      }),
    ]);
    return { totalPendentes: total, mostrando: linhas.length, linhas: linhas.map((l) => ({ ...l, valorRecebidoCat: din(l.valorRecebidoCat) })) };
  },
});

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

const listarRegras = ferramenta({
  nome: "listar_regras",
  titulo: "Listar regras de categoria",
  descricao:
    "As regras que mapeiam nome de serviço/plano para categoria. Filtre por trecho do nome ou por categoria. Uma regra mapeia o NOME EXATO (só trim; espaço duplo é real e preservado). Para criar/alterar, salvar_regra_categoria.",
  entrada: z.object({
    busca: z.string().optional().describe("Trecho do nome."),
    categoria: z.string().optional(),
    apenasAtivas: z.boolean().default(true),
    limite: limite(500, 100),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const where: Prisma.RevenueCategoryRuleWhereInput = {
      ...(a.apenasAtivas ? { ativo: true } : {}),
      ...(a.categoria ? { categoria: a.categoria } : {}),
      ...(a.busca ? { nome: { contains: a.busca, mode: "insensitive" } } : {}),
    };
    const [total, regras] = await Promise.all([
      prisma.revenueCategoryRule.count({ where }),
      prisma.revenueCategoryRule.findMany({ where, orderBy: [{ categoria: "asc" }, { nome: "asc" }], take: a.limite }),
    ]);
    return { total, mostrando: regras.length, regras: regras.map((r) => ({ id: r.id, nome: r.nome, categoria: r.categoria, ativo: r.ativo, atualizadoEm: r.updatedAt })) };
  },
});

const servicosSemCategoria = ferramenta({
  nome: "servicos_sem_categoria",
  titulo: "Serviços sem categoria",
  descricao:
    "Os nomes de serviço/plano que caíram em 'Sem Categoria', com quantas linhas, quanto dinheiro e o intervalo de datas. É a lista do que falta mapear: cada item resolve com salvar_regra_categoria (e depois uma sincronização do período, que recategoriza).",
  entrada: z.object({ de: dataIso.optional(), ate: dataIso.optional(), limite: limite(300, 100) }),
  somenteLeitura: true,
  executar: async (a) => {
    const where: Prisma.RevenueCategorizedLineWhereInput = {
      categoria: "Sem Categoria",
      ...(a.de || a.ate ? { dataCredito: { ...(a.de ? { gte: paraData(a.de) } : {}), ...(a.ate ? { lte: paraData(a.ate) } : {}) } } : {}),
    };
    const g = await prisma.revenueCategorizedLine.groupBy({
      by: ["servicoOuPlano"], where, _sum: { valorRecebidoCat: true }, _count: { _all: true }, _min: { dataCredito: true }, _max: { dataCredito: true },
      orderBy: { _sum: { valorRecebidoCat: "desc" } }, take: a.limite,
    });
    return {
      itens: g.map((x) => ({ nome: x.servicoOuPlano, linhas: x._count._all, total: din(x._sum.valorRecebidoCat), de: iso(x._min.dataCredito), ate: iso(x._max.dataCredito) })),
      mostrandoTodos: g.length < a.limite,
    };
  },
});

// ---------------------------------------------------------------------------
// Metas, conflitos, inadimplência
// ---------------------------------------------------------------------------

const consultarMetas = ferramenta({
  nome: "consultar_metas",
  titulo: "Consultar metas",
  descricao:
    "Realizado × meta do período (mensal e trimestral são independentes), por escopo de categoria. O escopo 'todas as categorias' SE SOBREPÕE aos outros: não some as barras. Em período fechado e reprocessado, o realizado reflete as regras de hoje.",
  entrada: z.object({
    granularidade: z.enum(["month", "quarter", "semester", "year"]).default("month"),
    referencia: dataIso.optional(),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    if (a.referencia) paraData(a.referencia);
    const periodo = getPeriodBounds(a.granularidade, a.referencia);
    return { periodo: periodo.label, metas: await buildMetas(periodo, nowInAppTz()) };
  },
});

const historicoDeMetas = ferramenta({
  nome: "historico_de_metas",
  titulo: "Histórico de alterações de meta",
  descricao: "Quem mudou qual meta, de quanto para quanto e quando. Use para auditar uma meta que 'mudou sozinha'.",
  entrada: z.object({ limite: limite(200, 30) }),
  somenteLeitura: true,
  executar: async ({ limite: take }) => {
    const ev = await prisma.metaPeriodoEvent.findMany({
      orderBy: { criadoEm: "desc" }, take,
      include: { metaPeriodo: { select: { periodoChave: true, granularidade: true, escopo: { select: { nome: true, slug: true } } } }, alteradoPor: { select: { email: true } } },
    });
    return ev.map((e) => ({
      quando: e.criadoEm, escopo: e.metaPeriodo.escopo.nome, slug: e.metaPeriodo.escopo.slug, granularidade: e.metaPeriodo.granularidade,
      periodo: e.metaPeriodo.periodoChave, de: din(e.valorAnterior), para: din(e.valorNovo), por: e.alteradoPor?.email ?? null,
    }));
  },
});

const listarConflitosTool = ferramenta({
  nome: "listar_conflitos",
  titulo: "Listar conflitos",
  descricao:
    "Faturas cuja soma de linhas num mês não bate com o valor da fatura (possível dupla contagem, normalmente uma linha revisada à mão ao lado de uma automática), com a classificação: manual_superada e duplicata_sem_categoria se resolvem sozinhas; ambiguo exige decisão humana. Para agir, resolver_conflito ou excluir_linha.",
  entrada: z.object({}),
  somenteLeitura: true,
  executar: async () => {
    const c = await listarConflitos();
    return { total: c.length, conflitos: c };
  },
});

const consultarInadimplentes = ferramenta({
  nome: "consultar_inadimplentes",
  titulo: "Consultar inadimplentes",
  descricao:
    "Cobranças não pagas com vencimento anterior a hoje (vence hoje não conta), por cliente ou por cobrança, com os mesmos filtros da tela. Vem da API v2 do Conexa, SEPARADA da receita, e não é afetada pelo captcha. `negotiated` fica fora de propósito (contá-la dobra a dívida). Confira `sincronizacao.em` para saber a idade dos dados.",
  entrada: z.object({
    visao: z.enum(["cliente", "cobranca"]).default("cliente"),
    de: dataIso.optional().describe("Vencimento a partir de."),
    ate: dataIso.optional().describe("Vencimento até."),
    q: z.string().optional().describe("Nome ou id do cliente."),
    status: z.enum(["unpaid", "protested", "juridical"]).optional(),
    unidade: z.string().optional(),
    ordem: z.enum(["valor", "vencimento"]).default("valor"),
    direcao: z.enum(["asc", "desc"]).optional(),
    pagina: z.number().int().min(1).default(1),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const f = lerFiltros({ ...a, dir: a.direcao, pagina: String(a.pagina) } as Record<string, string | undefined>);
    return consultarInadimplencia(f, keyToUtcDate(todayKey()));
  },
});

export const ferramentasDeConsulta: Ferramenta[] = [
  estadoDoSistema, listarRodadas, detalharRodada, panorama, agregarReceita, buscarLinhas, detalharFatura, filaDeRevisao,
  listarRegras, servicosSemCategoria, consultarMetas, historicoDeMetas, listarConflitosTool, consultarInadimplentes,
];
