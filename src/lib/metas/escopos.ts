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

/**
 * `ordem` é ALFABÉTICA pelo nome (pedido do usuário, 2026-07-28) — é o campo
 * que ordena tanto o Panorama quanto /metas. Ao acrescentar um escopo novo,
 * reordenar todos, não pendurar no fim.
 *
 * As categorias de cada escopo foram conferidas contra o banco REAL (linhas
 * gravadas + tabela de regras) antes de serem escritas aqui: "Salas Privativas"
 * repete o mesmo split de grafia de "Serviços de Espaço" (dois espaços em
 * Sebrae/Ayrton Senna, um em Seaway Center), enquanto "Endereço Fiscal",
 * "SeaBox" e "Meu Depósito" são categorias únicas, sem unidade e sem variante.
 */
export const ESCOPOS_INICIAIS: EscopoInicial[] = [
  {
    slug: "endereco-fiscal",
    nome: "Endereço Fiscal",
    ordem: 1,
    // Categoria única — não tem recorte por unidade nem variante de grafia
    // (confirmado no banco: 665 linhas, todas com a mesma string).
    categorias: ["Endereço Fiscal"],
  },
  {
    slug: "meu-deposito",
    nome: "Meu Depósito",
    ordem: 2,
    categorias: ["Meu Depósito"],
  },
  {
    slug: "salas-privativas",
    nome: "Salas Privativas",
    ordem: 3,
    // Mesmo split de "Serviços de Espaço": as linhas reais usam DOIS espaços em
    // Sebrae/Ayrton Senna e UM em Seaway Center. As variantes de um espaço
    // entram pelo mesmo motivo defensivo explicado no topo deste arquivo —
    // subcontar dinheiro em silêncio é pior que uma linha a mais na tela.
    categorias: [
      "Salas Privativas - Seaway Center",
      "Salas Privativas -  Sebrae", // DOIS espaços — o que está gravado hoje
      "Salas Privativas - Sebrae", // UM espaço — defensivo
      "Salas Privativas -  Ayrton Senna", // DOIS espaços — o que está gravado hoje
      "Salas Privativas - Ayrton Senna", // UM espaço — defensivo
    ],
  },
  {
    slug: "seabox",
    nome: "SeaBox",
    ordem: 4,
    categorias: ["SeaBox"],
  },
  {
    slug: "servicos-de-espaco",
    nome: "Serviços de Espaço",
    ordem: 5,
    categorias: [
      "Serviços de Espaço - Seaway Center",
      "Serviços de Espaço -  Sebrae", // DOIS espaços — FIXED_FALLBACKS (o que está nas linhas hoje)
      "Serviços de Espaço - Sebrae", // UM espaço — RevenueCategoryRule (seed normalizado)
      "Serviços de Espaço -  Ayrton Senna", // DOIS espaços — FIXED_FALLBACKS
      "Serviços de Espaço - Ayrton Senna", // UM espaço — RevenueCategoryRule
    ],
  },
];
