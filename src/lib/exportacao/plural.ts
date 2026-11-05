/**
 * Concordância em português para contagens (ADR-0035). PURO.
 *
 * "1 ativos", "1 dias", "1 conflito(s) têm" são erros que a Duda lê num relatório que vai para outras pessoas; as
 * frases com contagem escolhem singular ou plural aqui, em vez de usar "(s)".
 */

/** `plural(1, "dia", "dias")` → "dia"; `plural(0, ...)` e `plural(2, ...)` → "dias" (em português o zero é plural). */
export const plural = (n: number, singular: string, varios: string): string => (n === 1 ? singular : varios);

/** "1 dia", "2 dias", "0 dias". */
export const contagem = (n: number, singular: string, varios: string): string => `${n.toLocaleString("pt-BR")} ${plural(n, singular, varios)}`;
