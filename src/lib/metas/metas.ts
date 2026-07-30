import "server-only";
import { prisma } from "@/lib/db";
import type { MetaGranularidade } from "@prisma/client";
import { money, roundMoney, toAmountString, ZERO, type Money } from "@/lib/money";
import { getPeriodBounds, type PeriodBounds } from "@/lib/dates";
import { fracaoDecorrida, chaveDaData, chavesDoPeriodo, periodoAceitaMeta } from "@/lib/metas/periodo";

/**
 * Apuração de metas para o Panorama.
 *
 * Regras que valem para tudo aqui:
 *  - `realizado` e `%` NUNCA vêm do banco — são calculados ao vivo a partir das
 *    linhas atuais, por `dataCredito` (regime de caixa, o mesmo que o resto do
 *    app usa). Persistir o realizado repetiria o erro que a ADR-0013 corrigiu.
 *  - Mensal e trimestral são SÉRIES INDEPENDENTES (ADR-0026) — nunca uma é
 *    derivada da outra.
 *  - Quando só PARTE dos períodos-átomo tem meta, o realizado é recortado para
 *    EXATAMENTE os mesmos períodos. Dividir a receita de 4 trimestres por 1
 *    trimestre de meta produziria um "400% da meta" que parece apurado e é lixo.
 *
 * DOIS BLOCOS LADO A LADO (2026-07-28): o card mostra mensal E trimestral ao
 * mesmo tempo, cada um apurado no SEU período, em vez de mostrar só a
 * granularidade derivada da visão do Panorama. Antes, quem criava uma meta
 * trimestral e voltava ao Panorama (que abre em Mensal) não via nada e a tela
 * ainda afirmava "nenhuma meta definida" — a meta parecia ter sumido.
 *
 * Cada bloco carrega o RÓTULO do período que apurou ("julho de 2026", "3º
 * trimestre de 2026"), porque os dois podem cobrir intervalos diferentes: numa
 * visão mensal, o bloco trimestral apura o trimestre INTEIRO que contém o mês,
 * então o realizado dele é legitimamente maior que o KPI da página. Sem o
 * rótulo explícito, seriam dois números de receita na mesma tela sem dizer que
 * são de recortes diferentes — exatamente o tipo de ambiguidade que este
 * projeto trata como bug.
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
  /** Escopo que soma TODA a receita — se sobrepõe aos demais, a UI avisa. */
  abrangeTudo: boolean;
}

export interface BlocoMetas {
  granularidade: MetaGranularidade;
  /** Período REALMENTE apurado por este bloco, ex. "julho de 2026". */
  label: string;
  /** true quando este bloco apura um intervalo diferente do que a página mostra. */
  difereDaVisao: boolean;
  escopos: MetaEscopoResolvido[];
  /**
   * Agregado do bloco — soma APENAS os escopos que não abrangem tudo. Um escopo
   * "Total recebido" já contém a receita dos outros, então somá-lo aqui
   * contaria dinheiro duas vezes. null = nenhum escopo por categoria tem meta.
   */
  totalMeta: string | null;
  totalRealizado: string;
  percentualTotal: number | null;
  /** Quantos períodos-átomo (meses ou trimestres) o intervalo cobre. */
  periodosNoIntervalo: number;
  /** Todos eles têm meta? Se não, a comparação é recortada. */
  metaCompleta: boolean;
  /** Ritmo LINEAR até hoje (0..100), ou null se o intervalo não está em andamento. */
  ritmoEsperadoPct: number | null;
}

export interface MetasDoPeriodo {
  /** false em dia/semana — ratear meta por recorte tão fino inventaria número. */
  aplicavel: boolean;
  motivo?: string;
  /** Existe pelo menos um escopo ativo cadastrado? Distingue "sem meta" de "sem escopo". */
  temEscopos: boolean;
  /** Mensal e/ou trimestral, na ordem de exibição. Vazio quando !aplicavel ou sem escopos. */
  blocos: BlocoMetas[];
}

function pct(parte: Money, todo: Money): number | null {
  if (todo.lessThanOrEqualTo(0)) return null;
  return Number(parte.div(todo).times(100).toFixed(1));
}

type EscopoComCategorias = {
  id: string;
  slug: string;
  nome: string;
  categorias: Array<{ categoria: string }>;
  /** true = soma TODA a receita do período, ignorando `categorias` (ver schema.prisma). */
  todasCategorias: boolean;
};

/** Apura UM bloco (uma granularidade, um intervalo) — o miolo que era o corpo de buildMetas. */
async function calcularBloco(
  escopos: EscopoComCategorias[],
  granularidade: MetaGranularidade,
  intervalo: PeriodBounds,
  agora: Date,
  difereDaVisao: boolean,
): Promise<BlocoMetas> {
  const chaves = chavesDoPeriodo(intervalo, granularidade);
  const escopoIds = escopos.map((e) => e.id);

  // Escopos "todas as categorias" (ex. Total recebido) somam a receita INTEIRA
  // do período. Se existir algum, a busca não pode filtrar por categoria —
  // filtrar pela união das categorias dos OUTROS escopos deixaria de fora
  // justamente o que ainda não tem escopo (Outros Serviços, Sem Categoria...),
  // e o total pararia de bater com o KPI "Total recebido no período".
  const escoposGlobais = escopos.filter((e) => e.todasCategorias);
  const categoriasDosEscopos = [...new Set(escopos.flatMap((e) => e.categorias.map((c) => c.categoria)))];
  const semNadaPraBuscar = escoposGlobais.length === 0 && categoriasDosEscopos.length === 0;

  const [metasPeriodo, linhas] = await Promise.all([
    prisma.metaPeriodo.findMany({
      where: { escopoId: { in: escopoIds }, granularidade, periodoChave: { in: chaves } },
      select: { escopoId: true, periodoChave: true, valor: true },
    }),
    semNadaPraBuscar
      ? Promise.resolve([])
      : prisma.revenueCategorizedLine.findMany({
          where: {
            ...(escoposGlobais.length === 0 ? { categoria: { in: categoriasDosEscopos } } : {}),
            dataCredito: { gte: intervalo.fromDate, lt: intervalo.toDateExclusive },
          },
          select: { categoria: true, valorRecebidoCat: true, dataCredito: true },
        }),
  ]);

  const metaPorEscopoChave = new Map<string, Map<string, Money>>();
  for (const m of metasPeriodo) {
    const porChave = metaPorEscopoChave.get(m.escopoId) ?? new Map<string, Money>();
    porChave.set(m.periodoChave, money(m.valor.toString()));
    metaPorEscopoChave.set(m.escopoId, porChave);
  }
  const escopoDaCategoria = new Map<string, string>();
  for (const e of escopos) {
    if (e.todasCategorias) continue; // não tem categoria própria: pega tudo abaixo
    for (const c of e.categorias) escopoDaCategoria.set(c.categoria, e.id);
  }

  const realizadoPorEscopoChave = new Map<string, Map<string, Money>>();
  const somar = (escopoId: string, chave: string, valor: Money) => {
    const porChave = realizadoPorEscopoChave.get(escopoId) ?? new Map<string, Money>();
    porChave.set(chave, (porChave.get(chave) ?? ZERO).plus(valor));
    realizadoPorEscopoChave.set(escopoId, porChave);
  };

  for (const l of linhas) {
    if (!l.dataCredito) continue;
    const chave = chaveDaData(l.dataCredito, granularidade);
    const valor = money(l.valorRecebidoCat.toString());
    // Uma linha entra no escopo da SUA categoria (se houver) e, além disso, em
    // TODO escopo global. Os dois não competem: o global existe justamente para
    // se sobrepor — a UI avisa disso para ninguém somar as barras.
    const escopoId = escopoDaCategoria.get(l.categoria);
    if (escopoId) somar(escopoId, chave, valor);
    for (const g of escoposGlobais) somar(g.id, chave, valor);
  }

  let totalMeta = ZERO;
  let totalRealizado = ZERO;
  let algumaMeta = false;
  // Só os escopos que NÃO abrangem tudo entram no agregado do bloco.
  let algumMetaNaoGlobal = false;
  let todasChavesComMeta = true;

  const resolvidos: MetaEscopoResolvido[] = escopos.map((e) => {
    const metasDoEscopo = metaPorEscopoChave.get(e.id);
    const realizadoDoEscopo = realizadoPorEscopoChave.get(e.id);
    const chavesComMeta = chaves.filter((c) => metasDoEscopo?.has(c));

    if (chavesComMeta.length === 0) {
      // Sem meta: ainda assim mostramos o realizado do intervalo inteiro, que é
      // informação honesta e ajuda a calibrar a meta a ser definida. NÃO marca
      // o bloco como incompleto — "incompleto" é ter meta em alguns
      // períodos-átomo e não em todos, que é quando o realizado é recortado.
      const realizadoTotal = chaves.reduce<Money>((acc, c) => acc.plus(realizadoDoEscopo?.get(c) ?? ZERO), ZERO);
      return {
        slug: e.slug,
        nome: e.nome,
        meta: null,
        realizado: toAmountString(roundMoney(realizadoTotal)),
        percentual: null,
        falta: null,
        periodosComMeta: 0,
        abrangeTudo: e.todasCategorias,
      };
    }

    if (chavesComMeta.length < chaves.length) todasChavesComMeta = false;
    algumaMeta = true;

    const metaSoma = chavesComMeta.reduce<Money>((acc, c) => acc.plus(metasDoEscopo!.get(c)!), ZERO);
    const realizadoSoma = chavesComMeta.reduce<Money>((acc, c) => acc.plus(realizadoDoEscopo?.get(c) ?? ZERO), ZERO);

    // Escopo que abrange TUDO fica FORA do agregado do bloco: a receita dele já
    // inclui a dos outros, então somá-lo contaria dinheiro duas vezes. Ele
    // aparece na própria linha, com a marca de "todas as categorias".
    if (!e.todasCategorias) {
      totalMeta = totalMeta.plus(metaSoma);
      totalRealizado = totalRealizado.plus(realizadoSoma);
      algumMetaNaoGlobal = true;
    }

    const faltante = metaSoma.minus(realizadoSoma);
    return {
      slug: e.slug,
      nome: e.nome,
      meta: toAmountString(roundMoney(metaSoma)),
      realizado: toAmountString(roundMoney(realizadoSoma)),
      percentual: pct(realizadoSoma, metaSoma),
      falta: toAmountString(roundMoney(faltante.isNegative() ? ZERO : faltante)),
      periodosComMeta: chavesComMeta.length,
      abrangeTudo: e.todasCategorias,
    };
  });

  const fracao = fracaoDecorrida(intervalo, agora);

  return {
    granularidade,
    label: intervalo.label,
    difereDaVisao,
    escopos: resolvidos,
    totalMeta: algumMetaNaoGlobal ? toAmountString(roundMoney(totalMeta)) : null,
    totalRealizado: toAmountString(roundMoney(totalRealizado)),
    percentualTotal: algumMetaNaoGlobal ? pct(totalRealizado, totalMeta) : null,
    periodosNoIntervalo: chaves.length,
    metaCompleta: algumaMeta && todasChavesComMeta,
    ritmoEsperadoPct: fracao === null ? null : Number((fracao * 100).toFixed(1)),
  };
}

/**
 * Quais blocos aparecem para cada visão do Panorama.
 *
 * - **mês**: mensal (o próprio mês) + trimestral (o trimestre que o CONTÉM —
 *   intervalo maior que a visão, por isso `difereDaVisao`).
 * - **trimestre**: mensal (os 3 meses do trimestre) + trimestral (o trimestre).
 * - **semestre/ano**: só trimestral, cobrindo o período inteiro. Não existe
 *   bloco mensal aqui de propósito: somar 6 ou 12 metas mensais produziria um
 *   número que ninguém definiu, e a ADR-0026 já fixou que mês nunca soma pra
 *   cima — semestre/ano são a soma dos TRIMESTRES contidos.
 */
function blocosDaVisao(periodo: PeriodBounds): Array<{ granularidade: MetaGranularidade; intervalo: PeriodBounds }> {
  const trimestral = {
    granularidade: "TRIMESTRE" as const,
    intervalo: periodo.kind === "month" ? getPeriodBounds("quarter", periodo.fromKey) : periodo,
  };
  if (periodo.kind === "month" || periodo.kind === "quarter") {
    return [{ granularidade: "MES" as const, intervalo: periodo }, trimestral];
  }
  return [trimestral];
}

export async function buildMetas(periodo: PeriodBounds, agora: Date): Promise<MetasDoPeriodo> {
  const escopos = await prisma.metaEscopo.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: { categorias: { select: { categoria: true } } },
  });

  const base: MetasDoPeriodo = { aplicavel: periodoAceitaMeta(periodo.kind), temEscopos: escopos.length > 0, blocos: [] };

  if (!base.aplicavel) {
    return { ...base, motivo: "A meta é mensal ou trimestral — escolha Mensal, Trimestral, Semestral ou Anual." };
  }
  if (escopos.length === 0) return base;

  const blocos = await Promise.all(
    blocosDaVisao(periodo).map((b) =>
      calcularBloco(escopos, b.granularidade, b.intervalo, agora, b.intervalo.fromKey !== periodo.fromKey || b.intervalo.kind !== periodo.kind),
    ),
  );

  return { ...base, blocos };
}
