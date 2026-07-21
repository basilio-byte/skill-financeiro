import { describe, expect, it } from "vitest";
import { CategoryMatcher, SEM_CATEGORIA } from "@/lib/categorization/rules";

const RULES = [
  { nome: "Coworking Estação 08", categoria: "Salas Privativas - Seaway Center" },
  { nome: "EV - Endereço Fiscal Litoral", categoria: "Endereço Fiscal" },
  { nome: "Endereço Fiscal ", categoria: "Endereço Fiscal " }, // espaço à direita — testa normalização
];

describe("CategoryMatcher", () => {
  it("faz correspondência exata (normalizada)", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("coworking estação 08");
    expect(result).toEqual({ categoria: "Salas Privativas - Seaway Center", matchType: "exato" });
  });

  it("ignora espaços duplos/trailing ao normalizar", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Endereço  Fiscal");
    expect(result.matchType).toBe("exato");
  });

  it("faz correspondência exata ignorando sufixo Mensal/Anual/Bianual (SEAHUB COWORKING|SEATECH)", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("EV - Endereço Fiscal Litoral Mensal (SEAHUB COWORKING)");
    expect(result).toEqual({ categoria: "Endereço Fiscal", matchType: "sufixo" });
  });

  it("usa o maior prefixo cadastrado quando não há match exato", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("EV - Endereço Fiscal Litoral (algo extra não previsto)");
    expect(result).toEqual({ categoria: "Endereço Fiscal", matchType: "prefixo" });
  });

  it("aplica fallback fixo para prefixo [SEAWAY] -", () => {
    const matcher = new CategoryMatcher([]);
    const result = matcher.match("[SEAWAY] - SALA DE REUNIÃO 03 - 6 Pessoas (SEAHUB COWORKING)");
    expect(result).toEqual({ categoria: "Serviços de Espaço - Seaway Center", matchType: "fallback" });
  });

  it("devolve Sem Categoria quando nada resolve", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Serviço totalmente desconhecido XYZ");
    expect(result).toEqual({ categoria: SEM_CATEGORIA, matchType: "sem_categoria" });
  });
});
