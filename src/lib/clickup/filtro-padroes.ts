import { normalizarTexto } from "@/lib/text-normalize";

/**
 * Um vínculo ClickUp soma TODAS as linhas cuja categoria bate E cujo
 * `servicoOuPlano` contém QUALQUER UM dos padrões (OR) — nunca um cliente
 * específico (ver comentário do model ClickUpVinculo em schema.prisma).
 * Módulo separado (puro, sem Prisma runtime/DB) para ser reaproveitado tanto
 * pelo push real (push.ts) quanto pela prévia da tela admin (actions.ts),
 * sem duplicar a lógica de comparação.
 *
 * O casamento (`bateAlgumPadrao`) acontece em JS, não numa query `contains`
 * do Postgres — achado real (usuário, 2026-07-27): a mesma categoria tem
 * variantes de ACENTO na Conexa (ex. "Comércio" e "Comercio" convivem no
 * `servicoOuPlano` real), e o Postgres só ignora maiúscula/minúscula por
 * padrão (`mode: "insensitive"`), nunca acento — um padrão digitado com
 * acento não bateria na variante sem acento (e vice-versa) sem essa
 * normalização. Por isso quem chama busca as linhas só por `categoria` (e
 * `dataCredito` quando for o caso) e filtra por padrão aqui, em memória.
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

/**
 * `servicoOuPlano` contém QUALQUER UM dos padrões, ignorando acento e caixa
 * dos dois lados — "Comércio" (padrão) bate em "...De Comercio Mensal..."
 * (linha real) e vice-versa.
 */
export function bateAlgumPadrao(servicoOuPlano: string, padroes: string[]): boolean {
  if (padroes.length === 0) {
    throw new PadroesVazioError("Vínculo sem nenhum padrão — não há o que casar.");
  }
  const alvo = normalizarTexto(servicoOuPlano);
  return padroes.some((padrao) => alvo.includes(normalizarTexto(padrao)));
}
