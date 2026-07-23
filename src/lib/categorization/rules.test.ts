import { describe, expect, it } from "vitest";
import { CategoryMatcher, SEM_CATEGORIA, normServico } from "@/lib/categorization/rules";

const RULES = [
  { nome: "Coworking Estação 08", categoria: "Salas Privativas - Seaway Center" },
  { nome: "EV - Endereço Fiscal Litoral", categoria: "Endereço Fiscal" },
  { nome: "Multa Seatech", categoria: "Multas" },
];

describe("CategoryMatcher — porta exata de categoriza_receita.py (ADR-0018)", () => {
  it("faz correspondência exata (só trim, sem colapsar espaço)", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Coworking Estação 08");
    expect(result).toEqual({ categoria: "Salas Privativas - Seaway Center", matchType: "exato" });
  });

  it("é case-sensitive — o script real (str.strip() puro, sem lowercase) não casa maiúsculas diferentes", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("coworking estação 08");
    // Não bate exato (case diferente); "coworking estação 08" também não é
    // prefixo de nenhuma regra cadastrada (comparação também case-sensitive) -> Sem Categoria.
    expect(result.matchType).toBe("sem_categoria");
  });

  it("NÃO colapsa espaço duplo interno — nome com espaço extra não bate exato", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Coworking  Estação 08"); // dois espaços
    expect(result.matchType).toBe("sem_categoria");
  });

  it("faz correspondência exata ignorando sufixo COM palavra de periodicidade", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("EV - Endereço Fiscal Litoral Mensal (SEAHUB COWORKING)");
    expect(result).toEqual({ categoria: "Endereço Fiscal", matchType: "sufixo" });
  });

  it("faz correspondência exata ignorando sufixo SEM palavra de periodicidade (grupo opcional, igual ao Python)", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Multa Seatech (SEATECH)");
    expect(result).toEqual({ categoria: "Multas", matchType: "sufixo" });
  });

  it("usa o maior prefixo cadastrado quando não há match exato", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("EV - Endereço Fiscal Litoral (algo extra não previsto)");
    expect(result).toEqual({ categoria: "Endereço Fiscal", matchType: "prefixo" });
  });

  it("maior prefixo escolhe o candidato mais longo entre vários que combinam", () => {
    const rules = [
      { nome: "X", categoria: "Curta" },
      { nome: "XY", categoria: "Media" },
      { nome: "XYZ", categoria: "Longa" },
    ];
    const matcher = new CategoryMatcher(rules);
    expect(matcher.match("XYZW").categoria).toBe("Longa");
  });

  it("nome duplicado na tabela: a ÚLTIMA categoria cadastrada vence (mesma semântica de um dict Python)", () => {
    const rules = [
      { nome: "Repetido", categoria: "Primeira" },
      { nome: "Repetido", categoria: "Segunda" },
    ];
    const matcher = new CategoryMatcher(rules);
    expect(matcher.match("Repetido").categoria).toBe("Segunda");
  });

  it("aplica fallback fixo para prefixo [SEAWAY] -", () => {
    const matcher = new CategoryMatcher([]);
    const result = matcher.match("[SEAWAY] - SALA DE REUNIÃO 03 - 6 Pessoas (SEAHUB COWORKING)");
    expect(result).toEqual({ categoria: "Serviços de Espaço - Seaway Center", matchType: "fallback" });
  });

  it("aplica fallback fixo com espaço DUPLO para [SEBRAE] - (grafia real da tabela da Duda)", () => {
    const matcher = new CategoryMatcher([]);
    const result = matcher.match("[SEBRAE] - AUDITÓRIO EMPREENDA (SEAHUB COWORKING)");
    expect(result).toEqual({ categoria: "Serviços de Espaço -  Sebrae", matchType: "fallback" });
  });

  it("devolve Sem Categoria quando nada resolve", () => {
    const matcher = new CategoryMatcher(RULES);
    const result = matcher.match("Serviço totalmente desconhecido XYZ");
    expect(result).toEqual({ categoria: SEM_CATEGORIA, matchType: "sem_categoria" });
  });
});

describe("normServico", () => {
  it("remove sufixo com periodicidade", () => {
    expect(normServico("Item Anual (SEATECH)")).toBe("Item");
  });

  it("remove sufixo SEM periodicidade (grupo opcional)", () => {
    expect(normServico("Item (SEATECH)")).toBe("Item");
  });

  it("não colapsa espaço interno", () => {
    expect(normServico("Item  Duplo (SEATECH)")).toBe("Item  Duplo");
  });
});
