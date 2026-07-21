import { ZERO, sum, roundMoney, toAmountString, type Money } from "@/lib/money";
import { CategoryMatcher, SEM_CATEGORIA, type CategoryRule } from "@/lib/categorization/rules";
import { joinContasReceberComListarVendas } from "@/lib/categorization/join";
import type {
  CategorizationRunResult,
  CategorizedLine,
  ContasReceberRow,
  ListarVendasRow,
  ProporcionadoTipo,
} from "@/lib/categorization/types";
import { allocateProportionally } from "@/lib/categorization/rateio";

/**
 * Identidade estável de um bucket de categoria dentro de uma fatura — usada
 * como chave de upsert entre rodadas (ADR-0013, `RevenueCategorizedLine.chaveLinha`).
 * Precisa ser calculada a partir da categoria que a SKILL atribuiu (nunca a
 * que uma revisão manual sobrescreveu depois), para que a mesma composição de
 * itens LV produza sempre a mesma chave em rodadas futuras. "Sem Categoria"
 * inclui o nome exato do serviço/plano porque dois serviços não mapeados na
 * MESMA fatura são buckets distintos.
 */
export function chaveLinhaDoBucket(categoria: string, servicoOuPlano: string): string {
  return categoria === SEM_CATEGORIA ? `${categoria}::${servicoOuPlano}` : categoria;
}

/**
 * Núcleo puro do motor de categorização: recebe as linhas já filtradas por
 * status aceito + a tabela de regras, devolve as linhas categorizadas e o
 * resumo da rodada. Sem I/O (sem Prisma, sem fetch) — testável com fixtures.
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
      linhas.push(buildLinha(cr, match.categoria, cr.planoContratado, "SEM_LV", cr.valorRecebido, cr.valorRecebido));
      continue;
    }

    const categoriasPorItem = itensLV.map((lv) => {
      const match = matcher.match(lv.servicoItem);
      if (match.matchType === "sem_categoria" && lv.servicoItem) servicosNaoMapeados.add(lv.servicoItem);
      return match.categoria;
    });

    // Chave de agrupamento: categoria, EXCETO para "Sem Categoria" — aí agrupa
    // por (categoria, nome exato do serviço), para que dois serviços diferentes
    // e ambos não mapeados não sejam silenciosamente fundidos numa linha só
    // (cada um precisa aparecer separado na auditoria de /categorias). Mesma
    // fórmula usada como chaveLinha persistida (chaveLinhaDoBucket acima).
    const buckets = new Map<string, { categoria: string; nome: string; itens: ListarVendasRow[] }>();
    itensLV.forEach((lv, i) => {
      const categoria = categoriasPorItem[i]!;
      const key = chaveLinhaDoBucket(categoria, lv.servicoItem);
      const bucket = buckets.get(key);
      if (bucket) bucket.itens.push(lv);
      else buckets.set(key, { categoria, nome: lv.servicoItem, itens: [lv] });
    });

    if (buckets.size === 1) {
      const only = [...buckets.values()][0]!;
      linhas.push(buildLinha(cr, only.categoria, only.nome, "N", cr.valorRecebido, cr.valorRecebido));
      continue;
    }

    // Múltiplos buckets na mesma fatura -> rateio proporcional pelo peso (soma
    // do valor dos itens LV) de cada bucket.
    const bucketList = [...buckets.values()];
    const pesos = bucketList.map((b) => b.itens.reduce<Money>((acc, lv) => acc.plus(lv.valor), ZERO));
    const partes = allocateProportionally(cr.valorRecebido, pesos);
    bucketList.forEach((b, i) => {
      linhas.push(buildLinha(cr, b.categoria, b.nome, "S", partes[i]!, cr.valorRecebido));
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
    chaveLinha: chaveLinhaDoBucket(categoria, servicoOuPlano),
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
