import { money, type Money } from "@/lib/money";

/**
 * Só vale a pena chamar a API do ClickUp quando o valor realmente mudou —
 * tanto por causa da cota (100 req/min, e o escopo é todas as categorias por
 * cliente) quanto para não poluir o histórico de alterações do próprio campo
 * no ClickUp com o mesmo número repetido a cada sincronização.
 *
 * `valorUltimoSucesso` null significa "nunca empurrado com sucesso" — sempre
 * empurra nesse caso.
 */
export function devePush(valorUltimoSucesso: string | null, valorNovo: Money): boolean {
  if (valorUltimoSucesso === null) return true;
  return !money(valorUltimoSucesso).equals(valorNovo);
}
