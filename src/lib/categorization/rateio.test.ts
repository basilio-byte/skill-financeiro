import { describe, expect, it } from "vitest";
import { allocateProportionally } from "@/lib/categorization/rateio";
import { money, toAmountString, sum, roundMoney } from "@/lib/money";

describe("allocateProportionally", () => {
  it("rateia proporcionalmente e a soma fecha exata com o total", () => {
    const total = money("100.00");
    const partes = allocateProportionally(total, [money("30"), money("30"), money("40")]);
    expect(partes.map((p) => toAmountString(p))).toEqual(["30.00", "30.00", "40.00"]);
  });

  it("absorve o resíduo de arredondamento na última parcela", () => {
    const total = money("100.00");
    const partes = allocateProportionally(total, [money("1"), money("1"), money("1")]);
    const somaExata = toAmountString(roundMoney(sum(partes)));
    expect(somaExata).toBe("100.00");
  });

  it("distribui igualmente quando todos os pesos são zero", () => {
    const total = money("90.00");
    const partes = allocateProportionally(total, [money("0"), money("0"), money("0")]);
    expect(partes.map((p) => toAmountString(p))).toEqual(["30.00", "30.00", "30.00"]);
  });
});
