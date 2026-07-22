import "server-only";
import { prisma } from "@/lib/db";
import { money, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import type { PeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, mesDaData, mesesDoPeriodo, periodoAceitaMeta } from "@/lib/metas/periodo";

/**
 * Apuração de metas para o Panorama.
 *
 * Regras que valem para tudo aqui:
 *  - `realizado` e `%` NUNCA vêm do banco — são calculados ao vivo a partir das
 *    linhas atuais, por `dataCredito` (regime de caixa, o mesmo que o resto do
 *    app usa). Persistir o realizado repetiria o erro que a ADR-0013 corrigiu.
 *  - Meta é MENSAL. Trimestre/semestre/ano = soma dos meses contidos.
 *  - Quando só PARTE dos meses do período tem meta, o realizado é recortado
 *    para EXATAMENTE os mesmos meses. Dividir 12 meses de receita por 3 meses
 *    de meta produziria um "400% da meta" que parece apurado e é lixo.
 */

export interface MetaEscopoResolvido {
  slug: string;
  nome: string;
  /** null = nenhum mês do período tem meta definida. */
  meta: string | null;
  /** Receita dos meses COM meta (não do período inteiro), quando há meta parcial. */
  realizado: string;
  /** null quando não há meta, ou quando a meta é zero (divisão sem sentido). */
  percentual: number | null;
  /** Quanto falta para bater a meta; 0 se já bateu. */
  falta: string | null;
  mesesComMeta: number;
}

export interface MetasDoPeriodo {
  /** false em dia/semana — a meta é mensal e ratear inventaria número. */
  aplicavel: boolean;
  motivo?: string;
  escopos: MetaEscopoResolvido[];
  totalMeta: string | null;
  totalRealizado: string;
  percentualTotal: number | null;
  mesesNoPeriodo: number;
  /** Todos os meses do período têm meta? Se não, a comparação é recortada. */
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

  const meses = mesesDoPeriodo(periodo);
  const base: MetasDoPeriodo = {
    aplicavel: periodoAceitaMeta(periodo.kind),
    escopos: [],
    totalMeta: null,
    totalRealizado: toAmountString(ZERO),
    percentualTotal: null,
    mesesNoPeriodo: meses.length,
    metaCompleta: false,
    ritmoEsperadoPct: null,
    temEscopos: escopos.length > 0,
  };

  if (!base.aplicavel) {
    return { ...base, motivo: "A meta é mensal — escolha Mensal, Trimestral, Semestral ou Anual." };
  }
  if (escopos.length === 0) return base;

  const escopoIds = escopos.map((e) => e.id);
  const todasCategorias = [...new Set(escopos.flatMap((e) => e.categorias.map((c) => c.categoria)))];

  const [metasPeriodo, linhas] = await Promise.all([
    prisma.metaPeriodo.findMany({
      where: { escopoId: { in: escopoIds }, anoMes: { in: meses } },
      select: { escopoId: true, anoMes: true, valor: true },
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

  // (escopoId → anoMes → valor) e (categoria → escopoId)
  const metaPorEscopoMes = new Map<string, Map<string, Money>>();
  for (const m of metasPeriodo) {
    const porMes = metaPorEscopoMes.get(m.escopoId) ?? new Map<string, Money>();
    porMes.set(m.anoMes, money(m.valor.toString()));
    metaPorEscopoMes.set(m.escopoId, porMes);
  }
  const escopoDaCategoria = new Map<string, string>();
  for (const e of escopos) {
    for (const c of e.categorias) escopoDaCategoria.set(c.categoria, e.id);
  }

  // Receita por (escopo, mês) — o recorte por mês é o que permite comparar só
  // os meses que têm meta quando a configuração está incompleta.
  const realizadoPorEscopoMes = new Map<string, Map<string, Money>>();
  for (const l of linhas) {
    if (!l.dataCredito) continue; // sem data não pertence a mês nenhum
    const escopoId = escopoDaCategoria.get(l.categoria);
    if (!escopoId) continue;
    const mes = mesDaData(l.dataCredito);
    const porMes = realizadoPorEscopoMes.get(escopoId) ?? new Map<string, Money>();
    porMes.set(mes, (porMes.get(mes) ?? ZERO).plus(money(l.valorRecebidoCat.toString())));
    realizadoPorEscopoMes.set(escopoId, porMes);
  }

  let totalMeta = ZERO;
  let totalRealizado = ZERO;
  let algumaMeta = false;
  let todosMesesComMeta = true;

  const resolvidos: MetaEscopoResolvido[] = escopos.map((e) => {
    const metasDoEscopo = metaPorEscopoMes.get(e.id);
    const realizadoDoEscopo = realizadoPorEscopoMes.get(e.id);
    const mesesComMeta = meses.filter((m) => metasDoEscopo?.has(m));

    if (mesesComMeta.length === 0) {
      // Sem meta: ainda assim mostramos o realizado do período inteiro, que é
      // informação honesta e ajuda a calibrar a meta a ser definida.
      const realizadoTotal = meses.reduce<Money>(
        (acc, m) => acc.plus(realizadoDoEscopo?.get(m) ?? ZERO),
        ZERO,
      );
      // NÃO marca o período como incompleto: um escopo sem meta NENHUMA já se
      // explica sozinho na própria linha ("sem meta definida"). "Incompleto" é
      // outra coisa — escopo que tem meta em alguns meses do período e não em
      // todos, que é o caso em que o realizado precisa ser recortado. Misturar
      // os dois fazia o modo mensal exibir "nem todos os 1 meses têm meta".
      return {
        slug: e.slug,
        nome: e.nome,
        meta: null,
        realizado: toAmountString(roundMoney(realizadoTotal)),
        percentual: null,
        falta: null,
        mesesComMeta: 0,
      };
    }

    if (mesesComMeta.length < meses.length) todosMesesComMeta = false;
    algumaMeta = true;

    const metaSoma = mesesComMeta.reduce<Money>((acc, m) => acc.plus(metasDoEscopo!.get(m)!), ZERO);
    // Recorte deliberado: só os meses que têm meta entram no realizado.
    const realizadoSoma = mesesComMeta.reduce<Money>(
      (acc, m) => acc.plus(realizadoDoEscopo?.get(m) ?? ZERO),
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
      mesesComMeta: mesesComMeta.length,
    };
  });

  const fracao = fracaoDecorrida(periodo, agora);

  return {
    ...base,
    escopos: resolvidos,
    totalMeta: algumaMeta ? toAmountString(roundMoney(totalMeta)) : null,
    totalRealizado: toAmountString(roundMoney(totalRealizado)),
    percentualTotal: algumaMeta ? pct(totalRealizado, totalMeta) : null,
    metaCompleta: algumaMeta && todosMesesComMeta,
    ritmoEsperadoPct: fracao === null ? null : Number((fracao * 100).toFixed(1)),
  };
}
