import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, ZERO, toAmountString } from "@/lib/money";
import { diasDeAtraso, FAIXAS_DE_ATRASO, intervaloDaFaixa, type FiltrosInadimplencia } from "@/lib/inadimplencia/dominio";

export const POR_PAGINA = 50;

export interface LinhaCobranca {
  conexaId: number;
  customerConexaId: number | null;
  cliente: string;
  unidade: string | null;
  status: string;
  tipo: string | null;
  valor: string;
  valorOriginal: string;
  vencimento: Date;
  diasDeAtraso: number;
  telefone: string | null;
  email: string | null;
}

export interface LinhaCliente {
  customerConexaId: number | null;
  cliente: string;
  unidade: string | null;
  cobrancas: number;
  valor: string;
  maisAntigo: Date;
  maiorAtraso: number;
  statusPior: string;
  telefone: string | null;
  email: string | null;
}

export interface ResultadoInadimplencia {
  visao: "cliente" | "cobranca";
  linhas: LinhaCobranca[] | LinhaCliente[];
  /** Totais do conjunto FILTRADO (todas as páginas, não só a visível). */
  totais: { valor: string; cobrancas: number; clientes: number; maiorAtraso: number };
  /** Totais SEM filtro nenhum — o que existe de verdade, para a tela nunca parecer menor do que é. */
  geral: { valor: string; cobrancas: number; clientes: number };
  faixas: Array<{ chave: string; rotulo: string; de: string | null; ate: string; cobrancas: number; valor: string }>;
  unidades: string[];
  paginaAtual: number;
  totalDePaginas: number;
  totalDeLinhas: number;
  sincronizacao: { em: Date | null; status: string | null; erro: string | null; total: number | null };
}

const nomeDe = (nome: string | null, fantasia: string | null, id: number | null) => {
  const n = (nome ?? "").trim();
  const f = (fantasia ?? "").trim();
  if (n && f && f.toLowerCase() !== n.toLowerCase()) return `${n} (${f})`;
  return n || f || (id !== null ? `Cliente #${id}` : "Cliente sem identificação");
};

// Pior situação entre as cobranças do cliente: jurídico > protestada > em aberto.
const PESO_STATUS: Record<string, number> = { juridical: 3, protested: 2, unpaid: 1 };

/** Condição de banco equivalente aos filtros (sem a busca por nome, tratada junto). */
function condicao(f: FiltrosInadimplencia): Prisma.CobrancaEmAbertoWhereInput {
  const and: Prisma.CobrancaEmAbertoWhereInput[] = [];
  if (f.de || f.ate) and.push({ vencimento: { ...(f.de ? { gte: f.de } : {}), ...(f.ate ? { lte: f.ate } : {}) } });
  if (f.status) and.push({ status: f.status });
  if (f.unidade) and.push({ unidade: f.unidade });
  if (f.q) {
    const num = /^\d+$/.test(f.q) ? Number(f.q) : null;
    and.push({
      OR: [
        { clienteNome: { contains: f.q, mode: "insensitive" } },
        { clienteFantasia: { contains: f.q, mode: "insensitive" } },
        ...(num !== null && num < 2_147_483_647 ? [{ customerConexaId: num }, { conexaId: num }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export async function consultarInadimplencia(f: FiltrosInadimplencia, hoje: Date): Promise<ResultadoInadimplencia> {
  const where = condicao(f);

  const [agregado, porClienteFiltrado, geralAgg, geralClientes, ultimaRodada, unidadesDb, maisAntiga, faixasAgg] =
    await Promise.all([
      prisma.cobrancaEmAberto.aggregate({ where, _sum: { valor: true }, _count: { _all: true } }),
      prisma.cobrancaEmAberto.groupBy({ by: ["customerConexaId"], where, _count: { _all: true } }),
      prisma.cobrancaEmAberto.aggregate({ _sum: { valor: true }, _count: { _all: true } }),
      prisma.cobrancaEmAberto.groupBy({ by: ["customerConexaId"], _count: { _all: true } }),
      prisma.inadimplenciaSyncRun.findFirst({
        orderBy: { iniciadoEm: "desc" },
        select: { iniciadoEm: true, concluidoEm: true, status: true, erro: true, total: true },
      }),
      prisma.cobrancaEmAberto.findMany({ distinct: ["unidade"], select: { unidade: true }, orderBy: { unidade: "asc" } }),
      prisma.cobrancaEmAberto.findFirst({ where, orderBy: { vencimento: "asc" }, select: { vencimento: true } }),
      Promise.all(
        FAIXAS_DE_ATRASO.map((faixa) => {
          const { de, ate } = intervaloDaFaixa(faixa, hoje);
          return prisma.cobrancaEmAberto.aggregate({
            where: {
              vencimento: { ...(de ? { gte: new Date(`${de}T00:00:00.000Z`) } : {}), lte: new Date(`${ate}T00:00:00.000Z`) },
            },
            _sum: { valor: true },
            _count: { _all: true },
          });
        }),
      ),
    ]);

  const faixas = FAIXAS_DE_ATRASO.map((faixa, i) => {
    const { de, ate } = intervaloDaFaixa(faixa, hoje);
    return {
      chave: faixa.chave,
      rotulo: faixa.rotulo,
      de,
      ate,
      cobrancas: faixasAgg[i]!._count._all,
      valor: toAmountString(money(faixasAgg[i]!._sum.valor?.toString() ?? 0)),
    };
  });

  const totais = {
    valor: toAmountString(money(agregado._sum.valor?.toString() ?? 0)),
    cobrancas: agregado._count._all,
    clientes: porClienteFiltrado.length,
    maiorAtraso: maisAntiga ? diasDeAtraso(maisAntiga.vencimento, hoje) : 0,
  };
  const geral = {
    valor: toAmountString(money(geralAgg._sum.valor?.toString() ?? 0)),
    cobrancas: geralAgg._count._all,
    clientes: geralClientes.length,
  };

  const base = {
    totais,
    geral,
    faixas,
    unidades: unidadesDb.map((u) => u.unidade).filter((u): u is string => !!u),
    sincronizacao: {
      em: ultimaRodada ? (ultimaRodada.concluidoEm ?? ultimaRodada.iniciadoEm) : null,
      status: ultimaRodada?.status ?? null,
      erro: ultimaRodada?.erro ?? null,
      total: ultimaRodada?.total ?? null,
    },
  };

  // ------------------------------------------------------------------ cobrança
  if (f.visao === "cobranca") {
    const totalDeLinhas = totais.cobrancas;
    const totalDePaginas = Math.max(1, Math.ceil(totalDeLinhas / POR_PAGINA));
    const paginaAtual = Math.min(f.pagina, totalDePaginas);
    // Desempate por id: sem ele, valores iguais trocam de lugar entre páginas e
    // uma cobrança some/duplica na paginação.
    const orderBy: Prisma.CobrancaEmAbertoOrderByWithRelationInput[] = [
      f.ordem === "valor" ? { valor: f.direcao } : { vencimento: f.direcao },
      { conexaId: "asc" },
    ];
    const rows = await prisma.cobrancaEmAberto.findMany({
      where,
      orderBy,
      skip: (paginaAtual - 1) * POR_PAGINA,
      take: POR_PAGINA,
    });
    const linhas: LinhaCobranca[] = rows.map((r) => ({
      conexaId: r.conexaId,
      customerConexaId: r.customerConexaId,
      cliente: nomeDe(r.clienteNome, r.clienteFantasia, r.customerConexaId),
      unidade: r.unidade,
      status: r.status,
      tipo: r.tipo,
      valor: r.valor.toString(),
      valorOriginal: r.valorOriginal.toString(),
      vencimento: r.vencimento,
      diasDeAtraso: diasDeAtraso(r.vencimento, hoje),
      telefone: r.telefone,
      email: r.email,
    }));
    return { ...base, visao: "cobranca", linhas, paginaAtual, totalDePaginas, totalDeLinhas };
  }

  // ------------------------------------------------------------------- cliente
  const totalDeLinhas = totais.clientes;
  const totalDePaginas = Math.max(1, Math.ceil(totalDeLinhas / POR_PAGINA));
  const paginaAtual = Math.min(f.pagina, totalDePaginas);

  const grupos = await prisma.cobrancaEmAberto.groupBy({
    by: ["customerConexaId"],
    where,
    _sum: { valor: true },
    _count: { _all: true },
    _min: { vencimento: true },
    orderBy: [
      f.ordem === "valor" ? { _sum: { valor: f.direcao } } : { _min: { vencimento: f.direcao } },
      { customerConexaId: "asc" },
    ],
    skip: (paginaAtual - 1) * POR_PAGINA,
    take: POR_PAGINA,
  });

  // Nome/contato/pior status vêm das cobranças dos clientes DESTA página (uma
  // consulta só) — o groupBy não devolve texto.
  const ids = grupos.map((g) => g.customerConexaId).filter((x): x is number => x !== null);
  const detalhes = ids.length
    ? await prisma.cobrancaEmAberto.findMany({
        where: { AND: [where, { customerConexaId: { in: ids } }] },
        select: {
          customerConexaId: true,
          clienteNome: true,
          clienteFantasia: true,
          unidade: true,
          status: true,
          telefone: true,
          email: true,
        },
      })
    : [];
  const porCliente = new Map<number, (typeof detalhes)[number][]>();
  for (const d of detalhes) {
    if (d.customerConexaId === null) continue;
    const l = porCliente.get(d.customerConexaId) ?? [];
    l.push(d);
    porCliente.set(d.customerConexaId, l);
  }

  const linhas: LinhaCliente[] = grupos.map((g) => {
    const ds = g.customerConexaId !== null ? (porCliente.get(g.customerConexaId) ?? []) : [];
    const primeiro = ds[0];
    const pior = ds.reduce((acc, d) => ((PESO_STATUS[d.status] ?? 0) > (PESO_STATUS[acc] ?? 0) ? d.status : acc), "unpaid");
    return {
      customerConexaId: g.customerConexaId,
      cliente: nomeDe(primeiro?.clienteNome ?? null, primeiro?.clienteFantasia ?? null, g.customerConexaId),
      unidade: primeiro?.unidade ?? null,
      cobrancas: g._count._all,
      valor: toAmountString(money(g._sum.valor?.toString() ?? ZERO.toString())),
      maisAntigo: g._min.vencimento!,
      maiorAtraso: diasDeAtraso(g._min.vencimento!, hoje),
      statusPior: pior,
      telefone: ds.find((d) => d.telefone)?.telefone ?? null,
      email: ds.find((d) => d.email)?.email ?? null,
    };
  });

  return { ...base, visao: "cliente", linhas, paginaAtual, totalDePaginas, totalDeLinhas };
}
