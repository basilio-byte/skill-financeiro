import { type Money, ZERO, add, subtract, roundMoney } from "@/lib/money";

/**
 * Rateia `total` entre itens conforme os `weights`, com arredondamento a 2 casas.
 * A soma das parcelas é EXATAMENTE `total` (o resíduo vai para a última parcela).
 * Usado para o rateio proporcional de faturas multi-categoria ("Proporcionado: S").
 * Se todos os pesos forem zero, distribui igualmente.
 */
export function allocateProportionally(total: Money, weights: Money[]): Money[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce<Money>((a, w) => a.plus(w ?? ZERO), ZERO);
  const result: Money[] = [];
  let allocated: Money = ZERO;

  const useEqual = sumW.isZero();
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      result.push(roundMoney(subtract(total, allocated)));
    } else {
      const w = weights[i] ?? ZERO;
      const share = useEqual ? roundMoney(total.div(n)) : roundMoney(total.times(w).div(sumW));
      result.push(share);
      allocated = add(allocated, share);
    }
  }
  return result;
}
