import { describe, expect, it } from "vitest";
import { CategoryMatcher } from "@/lib/categorization/rules";
import { ESCOPOS_INICIAIS } from "@/lib/metas/escopos";

/**
 * Testes de CONTRATO entre as metas e o motor de categorização.
 *
 * Os literais abaixo são hardcoded de propósito — nunca importados de
 * ESCOPOS_INICIAIS nem de rules.ts. Um teste que lê a mesma constante que
 * pretende proteger é tautológico: quem "arrumar" o espaçamento edita a
 * constante, os dois lados mudam juntos, o teste segue verde e a meta para de
 * casar com as linhas gravadas no banco, em silêncio.
 */
describe("contrato entre escopos de meta e rules.ts", () => {
  // Sem regras cadastradas: força o caminho dos FIXED_FALLBACKS, que é quem
  // produz as categorias gravadas nas linhas de Sebrae/Ayrton hoje.
  const matcherSemRegras = new CategoryMatcher([]);

  it("o fallback de Seaway continua produzindo a grafia esperada", () => {
    expect(matcherSemRegras.match("[SEAWAY] - Sala de Reunião").categoria).toBe(
      "Serviços de Espaço - Seaway Center",
    );
  });

  it("o fallback de Sebrae continua com DOIS espaços depois do hífen", () => {
    // Os dois espaços são intencionais — herdados da skill categoriza-receita
    // original e presentes nas linhas já gravadas. Se este teste falhar porque
    // alguém "corrigiu" o espaçamento em rules.ts, a meta do Sebrae passa a
    // não somar as linhas antigas: atualize ESCOPOS_INICIAIS junto e planeje a
    // migração das linhas existentes.
    expect(matcherSemRegras.match("[SEBRAE] - Auditório").categoria).toBe("Serviços de Espaço -  Sebrae");
  });

  it("o fallback de Ayrton Senna continua com DOIS espaços depois do hífen", () => {
    expect(matcherSemRegras.match("[AYRTON SENNA] - Sala 1").categoria).toBe(
      "Serviços de Espaço -  Ayrton Senna",
    );
  });

  it("todo escopo cobre a grafia que o fallback produz", () => {
    const porSlug = new Map(ESCOPOS_INICIAIS.map((e) => [e.slug, e.categorias]));
    expect(porSlug.get("espaco-seaway")).toContain(matcherSemRegras.match("[SEAWAY] - x").categoria);
    expect(porSlug.get("espaco-sebrae")).toContain(matcherSemRegras.match("[SEBRAE] - x").categoria);
    expect(porSlug.get("espaco-ayrton-senna")).toContain(matcherSemRegras.match("[AYRTON SENNA] - x").categoria);
  });

  it("nenhuma categoria aparece em mais de um escopo (evita contar receita duas vezes)", () => {
    const vistas = new Map<string, string>();
    for (const escopo of ESCOPOS_INICIAIS) {
      for (const cat of escopo.categorias) {
        const anterior = vistas.get(cat);
        expect(anterior, `"${cat}" está em ${anterior} e em ${escopo.slug}`).toBeUndefined();
        vistas.set(cat, escopo.slug);
      }
    }
  });

  it("slugs são únicos", () => {
    const slugs = ESCOPOS_INICIAIS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
