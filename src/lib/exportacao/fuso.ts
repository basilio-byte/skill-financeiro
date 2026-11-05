import { APP_TZ } from "@/lib/dates";

/**
 * Como o fuso aparece para QUEM LÊ a planilha (ADR-0035): "fuso de Fortaleza, UTC−3", não "America/Fortaleza".
 * Um rótulo só em todas as telas e Leia-me. Fuso diferente do padrão (variável APP_TIMEZONE) sai pelo nome técnico.
 */
export function rotuloDoFuso(tz: string = APP_TZ): string {
  return tz === "America/Fortaleza" ? "fuso de Fortaleza, UTC−3" : `fuso ${tz}`;
}
