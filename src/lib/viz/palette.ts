/**
 * Tokens de visualização de dados — FONTE ÚNICA de cor para gráficos.
 *
 * Reaproveita os valores já validados no projeto irmão (seahub_financeiro) com
 * `validate_palette.js` contra a mesma superfície (cards brancos, #ffffff):
 * o azul de MAGNITUDE veio do par categórico [Receita #2a78d6, Despesa #eb6834]
 * que passou em todos os checks (CVD ΔE 24.7 protan / 32.7 tritan; visão normal
 * ΔE 33.6; contraste ≥ 3:1) — aqui usamos só o azul, porque este app não tem
 * despesa/polaridade, só RANKING de categorias/contas (magnitude = uma matiz).
 *
 * REGRAS (não quebrar):
 *  - Ranking de categorias/contas = MAGNITUDE, uma matiz só. Nunca uma cor por
 *    barra (duplicaria o que o comprimento já diz, e um serviço novo vira uma
 *    13ª cor sem fim).
 *  - Texto usa tokens de tinta, nunca a cor da série.
 */

/** Rampa sequencial de UMA matiz (azul) para magnitude/ordinal. */
export const SEQUENTIAL_BLUE = {
  s250: "#86b6ef",
  s350: "#5598e7",
  s450: "#2a78d6",
  s550: "#1c5cab",
  s650: "#104281",
} as const;

/** Cor única para barras de magnitude (ranking de categorias/contas). */
export const MAGNITUDE = SEQUENTIAL_BLUE.s450;

/** Cor única para a série "Total recebido" no gráfico por rodada (série única, sem legenda). */
export const TOTAL_RECEBIDO = SEQUENTIAL_BLUE.s450;

/** Cromo do gráfico — recessivo, hairline, sólido (nunca tracejado). */
export const CHROME = {
  surface: "#ffffff",
  gridline: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  textSecondary: "#52514e",
  textPrimary: "#0b0b0b",
} as const;

/**
 * Confiança da categorização (composição por `Proporcionado`) — diferente do
 * ranking de categorias/contas acima: aqui são só 3 estados FIXOS e com
 * significado de status (não magnitude aberta), então cada um leva uma cor
 * própria — mesmo princípio do `tone` de KpiCard e do card âmbar de
 * pendências em /categorias, nunca uma paleta categórica nova.
 *
 * Mesmos valores de `positive`/`warning`/`negative` em tailwind.config.ts —
 * não os tons "500" do Tailwind, que falham contraste não-textual (WCAG
 * 1.4.11, ≥3:1) contra o branco do Card: emerald-500 ≈ 2.5:1, amber-500 ≈
 * 2.1:1. Os tons abaixo (mais escuros) medem ≥5:1 cada.
 */
export const CONFIANCA = {
  unica: "#15803d" /* = tailwind `positive` — categoria única, valor integral */,
  rateado: "#b45309" /* = tailwind `warning` — rateada entre categorias, revisar */,
  semLv: "#b91c1c" /* = tailwind `negative` — sem correspondência no Listar Vendas, revisar */,
} as const;
