import Decimal from "decimal.js";

/**
 * Aritmética monetária com rigor. NUNCA use `number` para somar/multiplicar
 * dinheiro no projeto — sempre passe por aqui. Ver docs/context/financial-rigor.md.
 *
 * Usamos um clone isolado do Decimal para não afetar configurações globais.
 *  - precisão alta o suficiente para rateios;
 *  - arredondamento comercial (HALF_UP) ao materializar em reais.
 */
const M = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

/** Valor monetário a partir de number | string | Decimal | null | undefined. */
export function money(value: number | string | Decimal | null | undefined): Money {
  if (value === null || value === undefined || value === "") return new M(0);
  return new M(typeof value === "number" ? String(value) : value);
}

export const ZERO: Money = new M(0);

/** Soma segura de uma lista de valores (ignora null/undefined). */
export function sum(values: Array<number | string | Decimal | null | undefined>): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), new M(0));
}

export function add(a: Money, b: Money): Money {
  return a.plus(b);
}

export function subtract(a: Money, b: Money): Money {
  return a.minus(b);
}

/** Multiplica um valor por uma quantidade/fator. */
export function multiply(a: Money, factor: number | string | Decimal): Money {
  return a.times(money(factor));
}

/** Arredonda para 2 casas (centavos) no modo comercial. */
export function roundMoney(value: Money): Money {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Arredonda para 2 casas com HALF_EVEN — usar SÓ no rateio proporcional do
 * motor de categorização (arredondamento por item + resíduo de ajuste em
 * categorize-invoices.ts), nunca de forma genérica.
 *
 * Por quê: `round()` do Python é half-to-even, não half-up; a decisão
 * (auditoria 2026-07-23) foi aproximar desse modo por fidelidade ao script
 * original, sabendo que isso NÃO garante paridade total nos empates —
 * `round()` do Python opera sobre float64 (que já carrega erro de
 * representação binária antes mesmo de arredondar), enquanto aqui a
 * aritmética é decimal exata; um "empate" visto aqui pode não ser um empate
 * de verdade do lado do Python. Documentado como risco aceito em
 * financial-rigor.md. O total da fatura sempre fecha nos dois lados (o
 * resíduo corrige) — só a categoria que absorve o centavo pode divergir.
 */
export function roundMoneyRateio(value: Money): Money {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

export function isZero(value: Money): boolean {
  return value.isZero();
}

/** Converte para centavos inteiros (bigint) — útil para persistência/serialização exata. */
export function toCents(value: Money): bigint {
  return BigInt(roundMoney(value).times(100).toFixed(0));
}

/** String "1234.56" — segura para trafegar/persistir sem perda. */
export function toAmountString(value: Money): string {
  return roundMoney(value).toFixed(2);
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata em Real brasileiro: R$ 1.234,56 */
export function formatBRL(value: Money | number | string | null | undefined): string {
  return BRL.format(roundMoney(money(value)).toNumber());
}

/**
 * Percentual em pt-BR: 91,5% — vírgula decimal, não ponto.
 *
 * Existe porque interpolar o número cru (`{pct}%`) renderiza "91.5%", que é a
 * convenção inglesa. Some o decimal quando é inteiro ("88%", não "88,0%").
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Formato compacto para eixos/KPIs: R$ 1,2 mil / R$ 3,4 mi */
export function formatBRLCompact(value: Money | number | string | null | undefined): string {
  const n = roundMoney(money(value)).toNumber();
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return BRL.format(n);
}
