import { describe, expect, it } from "vitest";
import { devePush } from "@/lib/clickup/decisao-push";
import { money } from "@/lib/money";

describe("devePush", () => {
  it("empurra quando nunca houve sucesso anterior", () => {
    expect(devePush(null, money("100.00"))).toBe(true);
  });

  it("não empurra quando o valor não mudou", () => {
    expect(devePush("100.00", money("100.00"))).toBe(false);
  });

  it("empurra quando o valor mudou", () => {
    expect(devePush("100.00", money("100.01"))).toBe(true);
  });

  it("compara por valor, não por formatação da string (1.5 vs 1.50)", () => {
    expect(devePush("1.50", money("1.5"))).toBe(false);
  });
});
