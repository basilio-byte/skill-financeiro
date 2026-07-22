/**
 * Escopos de meta iniciais — "Serviços de Espaço" por unidade.
 *
 * Cada escopo lista as strings de categoria EXATAS que ele soma. Não é uma
 * string só por unidade de propósito: o projeto tem hoje DUAS grafias vivas da
 * mesma categoria, e uma meta amarrada a uma delas nasceria subcontando.
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
 * início, então a meta soma as duas em qualquer cenário.
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
    slug: "espaco-seaway",
    nome: "Serviços de Espaço — Seaway Center",
    ordem: 1,
    // Única unidade sem split: CSV e fallback concordam em UM espaço.
    categorias: ["Serviços de Espaço - Seaway Center"],
  },
  {
    slug: "espaco-sebrae",
    nome: "Serviços de Espaço — Sebrae",
    ordem: 2,
    categorias: [
      "Serviços de Espaço -  Sebrae", // DOIS espaços — FIXED_FALLBACKS (o que está nas linhas hoje)
      "Serviços de Espaço - Sebrae", // UM espaço — RevenueCategoryRule (seed normalizado)
    ],
  },
  {
    slug: "espaco-ayrton-senna",
    nome: "Serviços de Espaço — Ayrton Senna",
    ordem: 3,
    categorias: [
      "Serviços de Espaço -  Ayrton Senna", // DOIS espaços — FIXED_FALLBACKS
      "Serviços de Espaço - Ayrton Senna", // UM espaço — RevenueCategoryRule
    ],
  },
];
