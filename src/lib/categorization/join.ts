import type { ContasReceberRow, ListarVendasRow } from "@/lib/categorization/types";
import { yearMonthKey } from "@/lib/categorization/parse-exports";
import { money, type Money } from "@/lib/money";

/**
 * Cruza Contas a Receber × Listar Vendas pela chave `(Cliente ID, ano-mês)`.
 *
 * Por que ano-mês e não data exata: o CR guarda a competência com dia
 * variado, e o LV guarda a "Referência Cobrança" também com dias variados —
 * comparar só "YYYY-MM" garante o cruzamento correto independente do dia
 * (ver docs/context/decisions.md, porta fiel da lógica original da skill
 * categoriza-receita).
 */

export interface JoinedInvoice {
  cr: ContasReceberRow;
  itensLV: ListarVendasRow[]; // vazio => "Sem LV"
}

const VALOR_TOLERANCIA: Money = money("0.02");

function isCloseEnough(a: Money, b: Money): boolean {
  return a.minus(b).abs().lessThanOrEqualTo(VALOR_TOLERANCIA);
}

export function joinContasReceberComListarVendas(
  crRows: ContasReceberRow[],
  lvRows: ListarVendasRow[],
): JoinedInvoice[] {
  const lvByKey = new Map<string, ListarVendasRow[]>();
  for (const lv of lvRows) {
    if (lv.clienteId === null) continue;
    const ym = yearMonthKey(lv.referenciaCobranca);
    if (!ym) continue;
    const key = `${lv.clienteId}|${ym}`;
    const arr = lvByKey.get(key) ?? [];
    arr.push(lv);
    lvByKey.set(key, arr);
  }

  const crByKey = new Map<string, ContasReceberRow[]>();
  for (const cr of crRows) {
    if (cr.clienteId === null) continue;
    const ym = yearMonthKey(cr.competencia);
    if (!ym) continue;
    const key = `${cr.clienteId}|${ym}`;
    const arr = crByKey.get(key) ?? [];
    arr.push(cr);
    crByKey.set(key, arr);
  }

  const usedLvIds = new Set<number>();
  const results: JoinedInvoice[] = [];

  for (const cr of crRows) {
    if (cr.clienteId === null || !cr.competencia) {
      results.push({ cr, itensLV: [] });
      continue;
    }
    const key = `${cr.clienteId}|${yearMonthKey(cr.competencia)}`;
    const lvGroup = lvByKey.get(key) ?? [];
    const crGroup = crByKey.get(key) ?? [];

    if (lvGroup.length === 0) {
      results.push({ cr, itensLV: [] });
      continue;
    }

    if (crGroup.length === 1) {
      // Único CR nesse cliente/mês: todos os itens LV do grupo pertencem a ele.
      results.push({ cr, itensLV: lvGroup });
      for (const lv of lvGroup) usedLvIds.add(lv.id);
      continue;
    }

    // Múltiplos CRs no mesmo cliente/mês: desempate por valor. Um item de LV só
    // é usado exclusivamente para este CR se houver exatamente UM item do grupo
    // (ainda não usado por outro CR) cujo valor bate com o valor_recebido do CR
    // (tolerância R$0,02) — mesma regra documentada na skill original.
    const candidatos = lvGroup.filter(
      (lv) => !usedLvIds.has(lv.id) && isCloseEnough(lv.valor, cr.valorRecebido),
    );
    if (candidatos.length === 1) {
      results.push({ cr, itensLV: candidatos });
      usedLvIds.add(candidatos[0]!.id);
    } else {
      // Ambiguidade não resolvida pelo desempate documentado -> "Sem LV"
      // (conservador: evita atribuir itens de outra fatura por engano).
      results.push({ cr, itensLV: [] });
    }
  }

  return results;
}
