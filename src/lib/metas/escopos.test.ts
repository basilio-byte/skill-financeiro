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
describe("contrato entre escopo de meta e rules.ts", () => {
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
    // alguém "corrigiu" o espaçamento em rules.ts, a meta para de somar as
    // linhas antigas: atualize ESCOPOS_INICIAIS junto e planeje a migração.
    expect(matcherSemRegras.match("[SEBRAE] - Auditório").categoria).toBe("Serviços de Espaço -  Sebrae");
  });

  it("o fallback de Ayrton Senna continua com DOIS espaços depois do hífen", () => {
    expect(matcherSemRegras.match("[AYRTON SENNA] - Sala 1").categoria).toBe(
      "Serviços de Espaço -  Ayrton Senna",
    );
  });

  it("o escopo de Serviços de Espaço cobre as 3 grafias que os fallbacks produzem", () => {
    const escopo = ESCOPOS_INICIAIS.find((e) => e.slug === "servicos-de-espaco");
    expect(escopo).toBeDefined();
    expect(escopo!.categorias).toContain(matcherSemRegras.match("[SEAWAY] - x").categoria);
    expect(escopo!.categorias).toContain(matcherSemRegras.match("[SEBRAE] - x").categoria);
    expect(escopo!.categorias).toContain(matcherSemRegras.match("[AYRTON SENNA] - x").categoria);
  });

  it("o escopo de Salas Privativas cobre a grafia que o fallback de Coworking Estação produz", () => {
    // Único fallback de rules.ts que aponta pra Salas Privativas — se alguém
    // mudar a grafia lá, a meta desta categoria para de somar essas linhas.
    const escopo = ESCOPOS_INICIAIS.find((e) => e.slug === "salas-privativas");
    expect(escopo).toBeDefined();
    expect(escopo!.categorias).toContain(matcherSemRegras.match("Coworking Estação 08").categoria);
  });

  /**
   * As grafias abaixo são hardcoded de propósito (ver doc no topo): elas
   * precisam bater BYTE A BYTE com a `categoria` gravada em
   * RevenueCategorizedLine, senão a meta soma zero em silêncio. Foram
   * conferidas contra o banco real em 2026-07-28.
   */
  it("os 5 escopos existem, em ordem alfabética, com as grafias exatas das categorias reais", () => {
    expect(ESCOPOS_INICIAIS.map((e) => e.slug)).toEqual([
      "endereco-fiscal",
      "meu-deposito",
      "salas-privativas",
      "seabox",
      "servicos-de-espaco",
    ]);
    // `ordem` é o campo que ordena Panorama e /metas — precisa acompanhar.
    expect(ESCOPOS_INICIAIS.map((e) => e.ordem)).toEqual([1, 2, 3, 4, 5]);

    const porSlug = (slug: string) => ESCOPOS_INICIAIS.find((e) => e.slug === slug)!.categorias;
    expect(porSlug("endereco-fiscal")).toEqual(["Endereço Fiscal"]);
    expect(porSlug("meu-deposito")).toEqual(["Meu Depósito"]);
    expect(porSlug("seabox")).toEqual(["SeaBox"]);
    // Sebrae e Ayrton Senna com DOIS espaços depois do hífen; Seaway com UM.
    expect(porSlug("salas-privativas")).toContain("Salas Privativas -  Sebrae");
    expect(porSlug("salas-privativas")).toContain("Salas Privativas -  Ayrton Senna");
    expect(porSlug("salas-privativas")).toContain("Salas Privativas - Seaway Center");
  });

  it("nenhuma categoria aparece duplicada dentro do escopo", () => {
    const vistas = new Set<string>();
    for (const escopo of ESCOPOS_INICIAIS) {
      for (const cat of escopo.categorias) {
        expect(vistas.has(cat), `"${cat}" repetida em ${escopo.slug}`).toBe(false);
        vistas.add(cat);
      }
    }
  });

  it("slugs são únicos", () => {
    const slugs = ESCOPOS_INICIAIS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
