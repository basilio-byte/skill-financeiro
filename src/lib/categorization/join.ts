import type { ContasReceberRow, ListarVendasRow } from "@/lib/categorization/types";
import { yearMonthKey } from "@/lib/categorization/parse-exports";
import { money, type Money } from "@/lib/money";

/**
 * Cruza Contas a Receber × Listar Vendas — PORTA EXATA de
 * `categorizar_faturas`/`build_vendas_lookup` do categoriza_receita.py,
 * comparada linha a linha contra o script real em 2026-07-23 (ADR-0018).
 *
 * Chave: `(Cliente ID, ano-mês)`. Por que ano-mês e não data exata: o CR
 * guarda a competência com dia variado, e o LV guarda a "Referência
 * Cobrança" também com dias variados — comparar só "YYYY-MM" garante o
 * cruzamento correto independente do dia.
 *
 * IMPORTANTE — sem exclusividade entre faturas do mesmo cliente/mês: o
 * script real NÃO reserva/remove itens já usados por uma fatura anterior.
 * Cada fatura tenta o desempate por valor (ver `isCloseEnough`)
 * independentemente contra o MESMO grupo compartilhado de itens LV daquele
 * cliente/mês. Se o desempate não resolver para exatamente 1 item (zero ou 2+
 * batem), a fatura usa o GRUPO INTEIRO — nunca cai para "Sem LV" por
 * ambiguidade; só cai quando o grupo em si está vazio. Uma versão anterior
 * deste arquivo adicionava exclusividade (marcando itens como "já usados")
 * como salvaguarda contra dupla atribuição — mais conservadora que o
 * original, mas divergente dele. Removida de propósito: a Duda validou a
 * saída exatamente como o comportamento sem exclusividade produz.
 *
 * Cliente ID nulo TAMBÉM entra na chave, de propósito (auditoria 2026-07-23,
 * decisão explícita do usuário: fidelidade total ao Python). O script real
 * usa cliente_id como componente de chave de dict sem nenhuma guarda contra
 * None — duas linhas (uma de CR, uma de LV) do mesmo mês com "ID Cliente"
 * vazio podem colidir e se casar por esse acidente. Aqui a chave é uma
 * string (clienteId + "|" + ym), e null vira o literal "null" na
 * concatenação — mesmo efeito de colisão do dict Python, sem tratamento especial.
 */

export interface JoinedInvoice {
  cr: ContasReceberRow;
  itensLV: ListarVendasRow[];
}

// Replica `abs(valor_bruto - valor_recebido) < 0.02` — ESTRITO, não `<=`.
const VALOR_TOLERANCIA: Money = money("0.02");

function isCloseEnough(a: Money, b: Money): boolean {
  return a.minus(b).abs().lessThan(VALOR_TOLERANCIA);
}

export function joinContasReceberComListarVendas(
  crRows: ContasReceberRow[],
  lvRows: ListarVendasRow[],
): JoinedInvoice[] {
  const lvByKey = new Map<string, ListarVendasRow[]>();
  for (const lv of lvRows) {
    const ym = yearMonthKey(lv.referenciaCobranca);
    if (!ym) continue;
    const key = `${lv.clienteId}|${ym}`;
    const arr = lvByKey.get(key) ?? [];
    arr.push(lv);
    lvByKey.set(key, arr);
  }

  const results: JoinedInvoice[] = [];
  for (const cr of crRows) {
    if (!cr.competencia) {
      results.push({ cr, itensLV: [] });
      continue;
    }

    const key = `${cr.clienteId}|${yearMonthKey(cr.competencia)}`;
    let itensLV = lvByKey.get(key) ?? [];

    if (itensLV.length > 0) {
      const candidatos = itensLV.filter((lv) => isCloseEnough(lv.valor, cr.valorRecebido));
      if (candidatos.length === 1) {
        itensLV = candidatos;
      }
      // 0 ou 2+ candidatos: mantém o grupo INTEIRO, sem filtrar — igual ao script real.
    }

    results.push({ cr, itensLV });
  }

  return results;
}
