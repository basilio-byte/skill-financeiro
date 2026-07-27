import "server-only";
import { prisma } from "@/lib/db";
import { money, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import type { PeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, trimestreDaData, trimestresDoPeriodo, periodoAceitaMeta } from "@/lib/metas/periodo";

/**
 * Apuração de metas para o Panorama.
 *
 * Regras que valem para tudo aqui:
 *  - `realizado` e `%` NUNCA vêm do banco — são calculados ao vivo a partir das
 *    linhas atuais, por `dataCredito` (regime de caixa, o mesmo que o resto do
 *    app usa). Persistir o realizado repetiria o erro que a ADR-0013 corrigiu.
 *  - Meta é TRIMESTRAL. Semestre/ano = soma dos trimestres contidos.
 *  - Quando só PARTE dos trimestres do período tem meta, o realizado é
 *    recortado para EXATAMENTE os mesmos trimestres. Dividir 4 trimestres de
 *    receita por 1 trimestre de meta produziria um "400% da meta" que parece
 *    apurado e é lixo.
 */

export interface MetaEscopoResolvido {
  slug: string;
  nome: string;
  /** null = nenhum trimestre do período tem meta definida. */
  meta: string | null;
  /** Receita dos trimestres COM meta (não do período inteiro), quando há meta parcial. */
  realizado: string;
  /** null quando não há meta, ou quando a meta é zero (divisão sem sentido). */
  percentual: number | null;
  /** Quanto falta para bater a meta; 0 se já bateu. */
  falta: string | null;
  trimestresComMeta: number;
}

export interface MetasDoPeriodo {
  /** false em dia/semana/mês — a meta é trimestral e ratear inventaria número. */
  aplicavel: boolean;
  motivo?: string;
  escopos: MetaEscopoResolvido[];
  totalMeta: string | null;
  totalRealizado: string;
  percentualTotal: number | null;
  trimestresNoPeriodo: number;
  /** Todos os trimestres do período têm meta? Se não, a comparação é recortada. */
  metaCompleta: boolean;
  /**
   * Onde o ritmo LINEAR estaria hoje (0..100), ou null se o período não está
   * em andamento. Referência, não previsão — ver fracaoDecorrida().
   */
  ritmoEsperadoPct: number | null;
  /** Existe pelo menos um escopo ativo cadastrado? Distingue "sem meta" de "sem escopo". */
  temEscopos: boolean;
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

  const trimestres = trimestresDoPeriodo(periodo);
  const base: MetasDoPeriodo = {
    aplicavel: periodoAceitaMeta(periodo.kind),
    escopos: [],
    totalMeta: null,
    totalRealizado: toAmountString(ZERO),
    percentualTotal: null,
    trimestresNoPeriodo: trimestres.length,
    metaCompleta: false,
    ritmoEsperadoPct: null,
    temEscopos: escopos.length > 0,
  };

  if (!base.aplicavel) {
    return { ...base, motivo: "A meta é trimestral — escolha Trimestral, Semestral ou Anual." };
  }
  if (escopos.length === 0) return base;

  const escopoIds = escopos.map((e) => e.id);
  const todasCategorias = [...new Set(escopos.flatMap((e) => e.categorias.map((c) => c.categoria)))];

  const [metasPeriodo, linhas] = await Promise.all([
    prisma.metaPeriodo.findMany({
      where: { escopoId: { in: escopoIds }, anoTrimestre: { in: trimestres } },
      select: { escopoId: true, anoTrimestre: true, valor: true },
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
  ]);

  // (escopoId → anoTrimestre → valor) e (categoria → escopoId)
  const metaPorEscopoTrimestre = new Map<string, Map<string, Money>>();
  for (const m of metasPeriodo) {
    const porTrimestre = metaPorEscopoTrimestre.get(m.escopoId) ?? new Map<string, Money>();
    porTrimestre.set(m.anoTrimestre, money(m.valor.toString()));
    metaPorEscopoTrimestre.set(m.escopoId, porTrimestre);
  }
  const escopoDaCategoria = new Map<string, string>();
  for (const e of escopos) {
    for (const c of e.categorias) escopoDaCategoria.set(c.categoria, e.id);
  }

  // Receita por (escopo, trimestre) — o recorte por trimestre é o que permite
  // comparar só os trimestres que têm meta quando a configuração está incompleta.
  const realizadoPorEscopoTrimestre = new Map<string, Map<string, Money>>();
  for (const l of linhas) {
    if (!l.dataCredito) continue; // sem data não pertence a trimestre nenhum
    const escopoId = escopoDaCategoria.get(l.categoria);
    if (!escopoId) continue;
    const trimestre = trimestreDaData(l.dataCredito);
    const porTrimestre = realizadoPorEscopoTrimestre.get(escopoId) ?? new Map<string, Money>();
    porTrimestre.set(trimestre, (porTrimestre.get(trimestre) ?? ZERO).plus(money(l.valorRecebidoCat.toString())));
    realizadoPorEscopoTrimestre.set(escopoId, porTrimestre);
  }

  let totalMeta = ZERO;
  let totalRealizado = ZERO;
  let algumaMeta = false;
  let todosTrimestresComMeta = true;

  const resolvidos: MetaEscopoResolvido[] = escopos.map((e) => {
    const metasDoEscopo = metaPorEscopoTrimestre.get(e.id);
    const realizadoDoEscopo = realizadoPorEscopoTrimestre.get(e.id);
    const trimestresComMeta = trimestres.filter((t) => metasDoEscopo?.has(t));

    if (trimestresComMeta.length === 0) {
      // Sem meta: ainda assim mostramos o realizado do período inteiro, que é
      // informação honesta e ajuda a calibrar a meta a ser definida.
      const realizadoTotal = trimestres.reduce<Money>(
        (acc, t) => acc.plus(realizadoDoEscopo?.get(t) ?? ZERO),
        ZERO,
      );
      // NÃO marca o período como incompleto: um escopo sem meta NENHUMA já se
      // explica sozinho na própria linha ("sem meta definida"). "Incompleto" é
      // outra coisa — escopo que tem meta em alguns trimestres do período e
      // não em todos, que é o caso em que o realizado precisa ser recortado.
      return {
        slug: e.slug,
        nome: e.nome,
        meta: null,
        realizado: toAmountString(roundMoney(realizadoTotal)),
        percentual: null,
        falta: null,
        trimestresComMeta: 0,
      };
    }

    if (trimestresComMeta.length < trimestres.length) todosTrimestresComMeta = false;
    algumaMeta = true;

    const metaSoma = trimestresComMeta.reduce<Money>((acc, t) => acc.plus(metasDoEscopo!.get(t)!), ZERO);
    // Recorte deliberado: só os trimestres que têm meta entram no realizado.
    const realizadoSoma = trimestresComMeta.reduce<Money>(
      (acc, t) => acc.plus(realizadoDoEscopo?.get(t) ?? ZERO),
      ZERO,
    );

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
      trimestresComMeta: trimestresComMeta.length,
    };
  });

  const fracao = fracaoDecorrida(periodo, agora);

  return {
    ...base,
    escopos: resolvidos,
    totalMeta: algumaMeta ? toAmountString(roundMoney(totalMeta)) : null,
    totalRealizado: toAmountString(roundMoney(totalRealizado)),
    percentualTotal: algumaMeta ? pct(totalRealizado, totalMeta) : null,
    metaCompleta: algumaMeta && todosTrimestresComMeta,
    ritmoEsperadoPct: fracao === null ? null : Number((fracao * 100).toFixed(1)),
  };
}
