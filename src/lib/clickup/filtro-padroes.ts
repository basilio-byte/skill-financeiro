import type { Prisma } from "@prisma/client";

/**
 * Um vínculo ClickUp soma TODAS as linhas cuja categoria bate E cujo
 * `servicoOuPlano` contém QUALQUER UM dos padrões (OR) — nunca um cliente
 * específico (ver comentário do model ClickUpVinculo em schema.prisma).
 * Módulo separado (puro, sem Prisma runtime/DB) para ser reaproveitado tanto
 * pelo push real (push.ts) quanto pela prévia da tela admin (actions.ts),
 * sem duplicar a lógica de montagem do filtro.
 */

export class PadroesVazioError extends Error {}

/** Texto solto (um padrão por linha ou separado por vírgula) -> lista limpa, sem duplicatas nem vazios. */
export function normalizarPadroes(bruto: string): string[] {
  const vistos = new Set<string>();
  const limpos: string[] = [];
  for (const parte of bruto.split(/\r?\n|,/)) {
    const p = parte.trim();
    if (!p || vistos.has(p)) continue;
    vistos.add(p);
    limpos.push(p);
  }
  return limpos;
}

/** Monta o filtro Prisma (categoria + OR de `contains` case-insensitive por padrão). Nunca aceita lista vazia — vínculo sem padrão nenhum não tem significado. */
export function filtroPorPadroes(categoria: string, padroes: string[]): Prisma.RevenueCategorizedLineWhereInput {
  if (padroes.length === 0) {
    throw new PadroesVazioError("Vínculo sem nenhum padrão — não é possível montar o filtro.");
  }
  return {
    categoria,
    OR: padroes.map((padrao) => ({
      servicoOuPlano: { contains: padrao, mode: "insensitive" as const },
    })),
  };
}
