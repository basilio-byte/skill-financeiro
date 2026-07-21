import { ZERO, sum, roundMoney, toAmountString, type Money } from "@/lib/money";
import { CategoryMatcher, type CategoryRule } from "@/lib/categorization/rules";
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
      linhas.push(buildLinha(cr, match.categoria, "SEM_LV", cr.valorRecebido, cr.valorRecebido));
      continue;
    }

    const categoriasPorItem = itensLV.map((lv) => {
      const match = matcher.match(lv.servicoItem);
      if (match.matchType === "sem_categoria" && lv.servicoItem) servicosNaoMapeados.add(lv.servicoItem);
      return match.categoria;
    });
    const categoriasUnicas = [...new Set(categoriasPorItem)];

    if (categoriasUnicas.length === 1) {
      linhas.push(buildLinha(cr, categoriasUnicas[0]!, "N", cr.valorRecebido, cr.valorRecebido));
      continue;
    }

    // Múltiplas categorias na mesma fatura -> rateio proporcional pelo peso
    // (soma do valor dos itens LV) de cada categoria.
    const pesos = categoriasUnicas.map((categoria) =>
      itensLV
        .filter((_, i) => categoriasPorItem[i] === categoria)
        .reduce<Money>((acc, lv) => acc.plus(lv.valor), ZERO),
    );
    const partes = allocateProportionally(cr.valorRecebido, pesos);
    categoriasUnicas.forEach((categoria, i) => {
      linhas.push(buildLinha(cr, categoria, "S", partes[i]!, cr.valorRecebido));
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
