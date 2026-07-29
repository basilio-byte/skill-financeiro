import "server-only";
import { prisma } from "@/lib/db";
import type { MetaGranularidade } from "@prisma/client";
import { money, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import type { PeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, chaveDaData, chavesDoPeriodo, granularidadeDoKind } from "@/lib/metas/periodo";

/**
 * Apuração de metas para o Panorama.
 *
 * Regras que valem para tudo aqui:
 *  - `realizado` e `%` NUNCA vêm do banco — são calculados ao vivo a partir das
 *    linhas atuais, por `dataCredito` (regime de caixa, o mesmo que o resto do
 *    app usa). Persistir o realizado repetiria o erro que a ADR-0013 corrigiu.
 *  - Mensal e trimestral são SÉRIES INDEPENDENTES (2026-07-28): a visão de mês
 *    do Panorama usa metas MES; trimestre/semestre/ano usam metas TRIMESTRE —
 *    nunca uma é derivada da outra. Semestre/ano continuam somando os
 *    trimestres contidos, exatamente como antes de mês voltar a existir.
 *  - Quando só PARTE dos períodos-átomo (meses ou trimestres, conforme a
 *    granularidade) tem meta, o realizado é recortado para EXATAMENTE os
 *    mesmos períodos. Dividir a receita de 4 trimestres por 1 trimestre de
 *    meta produziria um "400% da meta" que parece apurado e é lixo.
 */

export interface MetaEscopoResolvido {
  slug: string;
  nome: string;
  /** null = nenhum período-átomo do intervalo tem meta definida. */
  meta: string | null;
  /** Receita dos períodos COM meta (não do intervalo inteiro), quando há meta parcial. */
  realizado: string;
  /** null quando não há meta, ou quando a meta é zero (divisão sem sentido). */
  percentual: number | null;
  /** Quanto falta para bater a meta; 0 se já bateu. */
  falta: string | null;
  periodosComMeta: number;
}

export interface MetasDoPeriodo {
  /** false em dia/semana — mês e trimestre agora aceitam meta direta, dia/semana continuam sem resposta honesta. */
  aplicavel: boolean;
  motivo?: string;
  /** Granularidade usada nesta apuração (MES pra visão de mês, TRIMESTRE pras demais); null quando !aplicavel. */
  granularidade: MetaGranularidade | null;
  escopos: MetaEscopoResolvido[];
  totalMeta: string | null;
  totalRealizado: string;
  percentualTotal: number | null;
  periodosNoPeriodo: number;
  /** Todos os períodos-átomo do intervalo têm meta? Se não, a comparação é recortada. */
  metaCompleta: boolean;
  /**
   * Onde o ritmo LINEAR estaria hoje (0..100), ou null se o período não está
   * em andamento. Referência, não previsão — ver fracaoDecorrida().
   */
  ritmoEsperadoPct: number | null;
  /** Existe pelo menos um escopo ativo cadastrado? Distingue "sem meta" de "sem escopo". */
  temEscopos: boolean;
  /**
   * Existe meta na OUTRA granularidade cobrindo este mesmo intervalo?
   *
   * Mensal e trimestral são séries independentes (ADR-0026), então a visão
   * mensal não enxerga uma meta trimestral — e vice-versa. Sem este aviso a
   * meta recém-criada "some" e a tela ainda afirma "nenhuma meta definida",
   * que é falso do ponto de vista de quem acabou de cadastrar uma. Pior: o
   * Panorama abre em Mensal e o formulário de meta abre em Trimestral, então o
   * caminho mais natural levava exatamente a esse silêncio.
   */
  metaNaOutraGranularidade: { granularidade: MetaGranularidade; periodos: string[] } | null;
}

function pct(parte: Money, todo: Money): number | null {
  if (todo.lessThanOrEqualTo(0)) return null;
  return Number(parte.div(todo).times(100).toFixed(1));
}

export async function buildMetas(periodo: PeriodBounds, agora: Date): Promise<MetasDoPeriodo> {
  const escopos = await prisma.metaEscopo.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: { categorias: { select: { categoria: true } } },
  });

  const granularidade = granularidadeDoKind(periodo.kind);
  const chaves = granularidade ? chavesDoPeriodo(periodo, granularidade) : [];
  const base: MetasDoPeriodo = {
    aplicavel: granularidade !== null,
    granularidade,
    escopos: [],
    totalMeta: null,
    totalRealizado: toAmountString(ZERO),
    percentualTotal: null,
    periodosNoPeriodo: chaves.length,
    metaCompleta: false,
    ritmoEsperadoPct: null,
    temEscopos: escopos.length > 0,
    metaNaOutraGranularidade: null,
  };

  if (!granularidade) {
    return { ...base, motivo: "A meta é mensal ou trimestral — escolha Mensal, Trimestral, Semestral ou Anual." };
  }
  if (escopos.length === 0) return base;

  const escopoIds = escopos.map((e) => e.id);
  const todasCategorias = [...new Set(escopos.flatMap((e) => e.categorias.map((c) => c.categoria)))];

  // A granularidade OPOSTA cobrindo o mesmo intervalo — só pra poder avisar
  // que a meta existe do outro lado, nunca pra somar junto (são séries
  // independentes). `chavesDoPeriodo` resolve os dois sentidos: pra uma visão
  // mensal devolve o trimestre que contém o mês; pra trimestral, os 3 meses.
  const outraGranularidade: MetaGranularidade = granularidade === "MES" ? "TRIMESTRE" : "MES";
  const chavesOutra = chavesDoPeriodo(periodo, outraGranularidade);

  const [metasPeriodo, linhas, metasOutra] = await Promise.all([
    prisma.metaPeriodo.findMany({
      where: { escopoId: { in: escopoIds }, granularidade, periodoChave: { in: chaves } },
      select: { escopoId: true, periodoChave: true, valor: true },
    }),
    todasCategorias.length === 0
      ? Promise.resolve([])
      : prisma.revenueCategorizedLine.findMany({
          where: {
            categoria: { in: todasCategorias },
            dataCredito: { gte: periodo.fromDate, lt: periodo.toDateExclusive },
          },
          select: { categoria: true, valorRecebidoCat: true, dataCredito: true },
        }),
    prisma.metaPeriodo.findMany({
      where: { escopoId: { in: escopoIds }, granularidade: outraGranularidade, periodoChave: { in: chavesOutra } },
      select: { periodoChave: true },
      distinct: ["periodoChave"],
      orderBy: { periodoChave: "asc" },
    }),
  ]);

  const metaNaOutraGranularidade =
    metasOutra.length > 0
      ? { granularidade: outraGranularidade, periodos: metasOutra.map((m) => m.periodoChave) }
      : null;

  // (escopoId → periodoChave → valor) e (categoria → escopoId)
  const metaPorEscopoChave = new Map<string, Map<string, Money>>();
  for (const m of metasPeriodo) {
    const porChave = metaPorEscopoChave.get(m.escopoId) ?? new Map<string, Money>();
    porChave.set(m.periodoChave, money(m.valor.toString()));
    metaPorEscopoChave.set(m.escopoId, porChave);
  }
  const escopoDaCategoria = new Map<string, string>();
  for (const e of escopos) {
    for (const c of e.categorias) escopoDaCategoria.set(c.categoria, e.id);
  }

  // Receita por (escopo, período-átomo) — o recorte é o que permite comparar
  // só os períodos que têm meta quando a configuração está incompleta.
  const realizadoPorEscopoChave = new Map<string, Map<string, Money>>();
  for (const l of linhas) {
    if (!l.dataCredito) continue; // sem data não pertence a período nenhum
    const escopoId = escopoDaCategoria.get(l.categoria);
    if (!escopoId) continue;
    const chave = chaveDaData(l.dataCredito, granularidade);
    const porChave = realizadoPorEscopoChave.get(escopoId) ?? new Map<string, Money>();
    porChave.set(chave, (porChave.get(chave) ?? ZERO).plus(money(l.valorRecebidoCat.toString())));
    realizadoPorEscopoChave.set(escopoId, porChave);
  }

  let totalMeta = ZERO;
  let totalRealizado = ZERO;
  let algumaMeta = false;
  let todasChavesComMeta = true;

  const resolvidos: MetaEscopoResolvido[] = escopos.map((e) => {
    const metasDoEscopo = metaPorEscopoChave.get(e.id);
    const realizadoDoEscopo = realizadoPorEscopoChave.get(e.id);
    const chavesComMeta = chaves.filter((c) => metasDoEscopo?.has(c));

    if (chavesComMeta.length === 0) {
      // Sem meta: ainda assim mostramos o realizado do intervalo inteiro, que
      // é informação honesta e ajuda a calibrar a meta a ser definida.
      const realizadoTotal = chaves.reduce<Money>((acc, c) => acc.plus(realizadoDoEscopo?.get(c) ?? ZERO), ZERO);
      // NÃO marca o período como incompleto: um escopo sem meta NENHUMA já se
      // explica sozinho na própria linha ("sem meta definida"). "Incompleto" é
      // outra coisa — escopo que tem meta em alguns períodos-átomo do
      // intervalo e não em todos, que é o caso em que o realizado precisa ser
      // recortado.
      return {
        slug: e.slug,
        nome: e.nome,
        meta: null,
        realizado: toAmountString(roundMoney(realizadoTotal)),
        percentual: null,
        falta: null,
        periodosComMeta: 0,
      };
    }

    if (chavesComMeta.length < chaves.length) todasChavesComMeta = false;
    algumaMeta = true;

    const metaSoma = chavesComMeta.reduce<Money>((acc, c) => acc.plus(metasDoEscopo!.get(c)!), ZERO);
    // Recorte deliberado: só os períodos que têm meta entram no realizado.
    const realizadoSoma = chavesComMeta.reduce<Money>((acc, c) => acc.plus(realizadoDoEscopo?.get(c) ?? ZERO), ZERO);

    totalMeta = totalMeta.plus(metaSoma);
    totalRealizado = totalRealizado.plus(realizadoSoma);

    const faltante = metaSoma.minus(realizadoSoma);
    return {
      slug: e.slug,
      nome: e.nome,
      meta: toAmountString(roundMoney(metaSoma)),
      realizado: toAmountString(roundMoney(realizadoSoma)),
      percentual: pct(realizadoSoma, metaSoma),
      falta: toAmountString(roundMoney(faltante.isNegative() ? ZERO : faltante)),
      periodosComMeta: chavesComMeta.length,
    };
  });

  const fracao = fracaoDecorrida(periodo, agora);

  return {
    ...base,
    metaNaOutraGranularidade,
    escopos: resolvidos,
    totalMeta: algumaMeta ? toAmountString(roundMoney(totalMeta)) : null,
    totalRealizado: toAmountString(roundMoney(totalRealizado)),
    percentualTotal: algumaMeta ? pct(totalRealizado, totalMeta) : null,
    metaCompleta: algumaMeta && todasChavesComMeta,
    ritmoEsperadoPct: fracao === null ? null : Number((fracao * 100).toFixed(1)),
  };
}
