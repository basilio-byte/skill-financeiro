import { z } from "zod";

/** "yyyy-MM-dd" — o formato canônico do projeto para datas-calendário. */
export const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato yyyy-MM-dd (ex.: "2026-08-31")');

/**
 * Valor monetário como string decimal com PONTO ("1234.56").
 *
 * ⚠ Deliberado, igual à tela de metas: um parser "esperto" de pt-BR trataria
 * "25.000" (o jeito natural de escrever vinte e cinco mil) como vinte e cinco
 * reais, em silêncio. Formato único elimina a classe inteira do erro.
 */
export const valorDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'valor decimal com ponto e até 2 casas, sem milhar nem "R$" (ex.: "1234.56")');

export const limite = (max: number, padrao: number) =>
  z.number().int().min(1).max(max).default(padrao).describe(`Quantos resultados (máx. ${max}, padrão ${padrao}).`);

/** "yyyy-MM-dd" → meia-noite UTC, rejeitando data impossível (2026-02-31 viraria março). */
export function paraData(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Data inválida: "${iso}" (use yyyy-MM-dd).`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) throw new Error(`Data inexistente: "${iso}".`);
  return d;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Dinheiro do Prisma (Decimal) → string com 2 casas FIXAS, sem passar por float.
 * Decimal.toString() corta zeros à direita ("35000" em vez de "35000.00"), e um agente
 * que soma valores de formatos diferentes erra sem perceber. Todo dinheiro aqui é
 * Decimal(14,2).
 */
export const din = (v: { toString(): string; toFixed?: (n: number) => string } | null | undefined): string | null =>
  v == null ? null : typeof v.toFixed === "function" ? v.toFixed(2) : v.toString();
