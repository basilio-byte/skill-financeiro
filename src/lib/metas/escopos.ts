/**
 * Escopo de meta inicial — "Serviços de Espaço", somando as 3 unidades
 * (Seaway Center, Sebrae, Ayrton Senna) num único número.
 *
 * Até 2026-07-24 existiam 3 escopos separados (um por unidade); a Duda
 * alinhou que o acompanhamento deve ser unificado — uma meta só de "Serviços
 * de Espaço" cobrindo as 3. Unificar aqui é só remover a separação por
 * unidade da lista de categorias somadas; a lógica de rateio/apuração em
 * metas.ts não muda.
 *
 * Cada categoria abaixo é uma string EXATA gravada em
 * RevenueCategorizedLine.categoria. O projeto tem DUAS grafias vivas da mesma
 * categoria para Sebrae/Ayrton Senna — uma meta amarrada a uma só delas
 * nasceria subcontando:
 *
 *   scripts/seed-categories.mjs aplica normalize() na coluna categoria do CSV
 *   e grava "Serviços de Espaço - Sebrae"  (UM espaço)  em RevenueCategoryRule;
 *   src/lib/categorization/rules.ts FIXED_FALLBACKS grava
 *            "Serviços de Espaço -  Sebrae" (DOIS espaços) nas linhas.
 *
 * Hoje as linhas gravadas usam só a variante de DOIS espaços (todas caíram no
 * fallback), mas basta alguém cadastrar uma regra para um serviço "[SEBRAE] -"
 * em /categorias — regra exata tem prioridade sobre fallback (rules.ts) — para
 * a variante de UM espaço começar a aparecer. As duas entram aqui desde o
 * início, então a meta soma as duas em qualquer cenário. Seaway Center não
 * tem esse split — CSV e fallback concordam em UM espaço.
 *
 * NUNCA normalizar estas strings: elas precisam casar com o que está gravado
 * em RevenueCategorizedLine.categoria, espaçamento torto e tudo.
 * O teste em escopos.test.ts trava esses literais contra mudança acidental.
 */

export interface EscopoInicial {
  slug: string;
  nome: string;
  ordem: number;
  categorias: string[];
}

export const ESCOPOS_INICIAIS: EscopoInicial[] = [
  {
    slug: "servicos-de-espaco",
    nome: "Serviços de Espaço",
    ordem: 1,
    categorias: [
      "Serviços de Espaço - Seaway Center",
      "Serviços de Espaço -  Sebrae", // DOIS espaços — FIXED_FALLBACKS (o que está nas linhas hoje)
      "Serviços de Espaço - Sebrae", // UM espaço — RevenueCategoryRule (seed normalizado)
      "Serviços de Espaço -  Ayrton Senna", // DOIS espaços — FIXED_FALLBACKS
      "Serviços de Espaço - Ayrton Senna", // UM espaço — RevenueCategoryRule
    ],
  },
];
