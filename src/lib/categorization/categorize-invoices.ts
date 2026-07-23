import { ZERO, sum, roundMoney, roundMoneyRateio, toAmountString, type Money } from "@/lib/money";
import { CategoryMatcher, type CategoryRule } from "@/lib/categorization/rules";
import { joinContasReceberComListarVendas } from "@/lib/categorization/join";
import type {
  CategorizationRunResult,
  CategorizedLine,
  ContasReceberRow,
  ListarVendasRow,
  ProporcionadoTipo,
} from "@/lib/categorization/types";

/**
 * Identidade estável de um bucket de categoria dentro de uma fatura — usada
 * como chave de upsert entre rodadas (ADR-0013). Porta exata do script real
 * (ADR-0018): o bucket é SEMPRE a categoria pura. O script agrupa TODOS os
 * itens de uma fatura pela mesma string de categoria — inclusive quando são
 * serviços "Sem Categoria" DIFERENTES entre si (nesse caso os nomes ficam
 * concatenados com "; " numa única linha de saída, replicando
 * `"; ".join(...)` do Python) — não separamos mais por serviço dentro de
 * "Sem Categoria" como uma versão anterior deste arquivo fazia.
 */
export function chaveLinhaDoBucket(categoria: string): string {
  return categoria;
}

/**
 * Núcleo puro do motor de categorização — PORTA EXATA de
 * `categorizar_faturas` do categoriza_receita.py, comparada linha a linha
 * contra o script real em 2026-07-23 (ver docs/context/decisions.md,
 * ADR-0018). Sem I/O (sem Prisma, sem fetch) — testável com fixtures.
 */
export function categorizeInvoices(
  crRows: ContasReceberRow[],
  lvRows: ListarVendasRow[],
  rules: CategoryRule[],
): CategorizationRunResult {
  const matcher = new CategoryMatcher(rules);
  const joined = joinContasReceberComListarVendas(crRows, lvRows);

  const linhas: CategorizedLine[] = [];
  const servicosNaoMapeados = new Set<string>();
  let totalSemLV = 0;

  for (const { cr, itensLV } of joined) {
    if (itensLV.length === 0) {
      totalSemLV += 1;
      const match = matcher.match(cr.planoContratado);
      if (match.matchType === "sem_categoria" && cr.planoContratado) servicosNaoMapeados.add(cr.planoContratado);
      // Replica `fatura["plano"] or "Sem item"` do Python.
      const servicoOuPlano = cr.planoContratado || "Sem item";
      linhas.push(buildLinha(cr, match.categoria, servicoOuPlano, "SEM_LV", cr.valorRecebido, cr.valorRecebido));
      continue;
    }

    // Categoriza cada item individualmente.
    const categoriasPorItem = itensLV.map((lv) => {
      const match = matcher.match(lv.servicoItem);
      if (match.matchType === "sem_categoria" && lv.servicoItem) servicosNaoMapeados.add(lv.servicoItem);
      return match.categoria;
    });

    // Proporcionado: "S" quando há 2+ categorias DISTINTAS entre os itens da
    // fatura (replica `len(set(categorias)) > 1`) — mesmo que dois deles
    // sejam serviços "Sem Categoria" diferentes, contam como UMA categoria
    // (a própria string "Sem Categoria"), não duas.
    const categoriasDistintas = new Set(categoriasPorItem);
    const proporcionado: ProporcionadoTipo = categoriasDistintas.size > 1 ? "S" : "N";

    // Fase 1 — peso e valor por ITEM, arredondado INDIVIDUALMENTE, sem
    // correção cruzada aqui. Replica `val = round(valor_recebido * peso, 2)`
    // item a item, ANTES de agrupar por categoria. `roundMoneyRateio`
    // (HALF_EVEN) em vez do `roundMoney` genérico (HALF_UP) — aproxima do
    // modo de arredondamento do `round()` do Python nos empates exatos (ver
    // comentário de roundMoneyRateio em money.ts para o limite dessa fidelidade).
    const somaBruto = itensLV.reduce<Money>((acc, lv) => acc.plus(lv.valor), ZERO);
    const valoresPorItem = itensLV.map((lv) => {
      const share = somaBruto.isZero()
        ? cr.valorRecebido.div(itensLV.length)
        : cr.valorRecebido.times(lv.valor.div(somaBruto));
      return roundMoneyRateio(share);
    });

    // Fase 2 — agrupa por categoria (ordem de primeira aparição dos itens),
    // somando os valores JÁ arredondados por item. Replica `by_cat[cat] += val`.
    const buckets = new Map<string, { categoria: string; nomes: string[]; valor: Money }>();
    itensLV.forEach((lv, i) => {
      const categoria = categoriasPorItem[i]!;
      const bucket = buckets.get(categoria);
      if (bucket) {
        bucket.valor = bucket.valor.plus(valoresPorItem[i]!);
        // Sem dedup: replica `"; ".join(i["servico_item"] for i in itens ...)`
        // do Python, que concatena todo item da categoria, mesmo repetido —
        // 2 lançamentos idênticos na mesma fatura aparecem 2x (auditoria 2026-07-23).
        bucket.nomes.push(lv.servicoItem);
      } else {
        buckets.set(categoria, { categoria, nomes: [lv.servicoItem], valor: valoresPorItem[i]! });
      }
    });

    // Fase 3 — resíduo de arredondamento (fatura.valorRecebido menos a soma
    // dos buckets já somados) vai INTEIRO para o ÚLTIMO bucket, na ordem de
    // primeira aparição. Replica `ajuste` aplicado a `cats_list[-1]`. Isso
    // também cobre o caso de categoria única: com 1 bucket só, o ajuste
    // sempre fecha esse bucket em exatamente `cr.valorRecebido`.
    const bucketList = [...buckets.values()];
    const somaBuckets = sum(bucketList.map((b) => b.valor));
    const ajuste = roundMoneyRateio(cr.valorRecebido.minus(somaBuckets));

    bucketList.forEach((b, i) => {
      const valorFinal = i === bucketList.length - 1 ? b.valor.plus(ajuste) : b.valor;
      linhas.push(buildLinha(cr, b.categoria, b.nomes.join("; "), proporcionado, valorFinal, cr.valorRecebido));
    });
  }

  const porCategoria = new Map<string, Money>();
  for (const linha of linhas) {
    porCategoria.set(linha.categoria, (porCategoria.get(linha.categoria) ?? ZERO).plus(linha.valorRecebidoCategoria));
  }
  const resumoPorCategoria = [...porCategoria.entries()]
    .map(([categoria, total]) => ({ categoria, total: toAmountString(roundMoney(total)) }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  return {
    linhas,
    totalLinhasCR: crRows.length,
    totalLinhasLV: lvRows.length,
    totalSemLV,
    totalRecebido: roundMoney(sum(linhas.map((l) => l.valorRecebidoCategoria))),
    resumoPorCategoria,
    servicosNaoMapeados: [...servicosNaoMapeados].sort(),
  };
}

function buildLinha(
  cr: ContasReceberRow,
  categoria: string,
  servicoOuPlano: string,
  proporcionado: ProporcionadoTipo,
  valorRecebidoCategoria: Money,
  valorRecebidoTotal: Money,
): CategorizedLine {
  return {
    crId: cr.id,
    unidade: cr.unidade,
    faturamento: cr.faturamento,
    clienteId: cr.clienteId,
    cpfCnpj: cr.cpfCnpj,
    razaoSocial: cr.razaoSocial,
    planoContratado: cr.planoContratado,
    categoria,
    servicoOuPlano,
    chaveLinha: chaveLinhaDoBucket(categoria),
    proporcionado,
    tipo: cr.tipo,
    status: cr.status,
    parcela: cr.parcela,
    valorRecebidoCategoria: roundMoney(valorRecebidoCategoria),
    valorRecebidoTotal: roundMoney(valorRecebidoTotal),
    valorBruto: cr.valorBruto,
    valorDesconto: cr.valorDesconto,
    vencimento: cr.vencimento,
    quitacao: cr.quitacao,
    competencia: cr.competencia,
    emissao: cr.emissao,
    dataCredito: cr.dataCredito,
    conta: cr.conta,
    observacoes: cr.observacoes,
    tags: cr.tags,
    raw: cr.raw,
  };
}
