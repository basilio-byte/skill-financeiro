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
