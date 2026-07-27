const MARCA_DIACRITICA_MIN = 0x0300;
const MARCA_DIACRITICA_MAX = 0x036f;

/**
 * Remove acentos (decompondo em NFD e descartando as marcas combinantes) e
 * caixa — "Comércio" e "Comercio" normalizam pro mesmo texto. Compartilhado
 * entre `clickup/mes-fields.ts` (nome de campo do ClickUp) e
 * `clickup/filtro-padroes.ts` (padrão de texto contra `servicoOuPlano`): as
 * duas comparações precisam da mesma regra, e o Postgres não ignora acento
 * por padrão (só maiúscula/minúscula com `mode: "insensitive"`), então essa
 * normalização precisa acontecer em JS, não numa query `contains`.
 */
export function normalizarTexto(texto: string): string {
  const semAcento = Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < MARCA_DIACRITICA_MIN || code > MARCA_DIACRITICA_MAX;
    })
    .join("");
  return semAcento.trim().toLowerCase();
}
