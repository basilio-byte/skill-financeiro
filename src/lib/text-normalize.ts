const MARCA_DIACRITICA_MIN = 0x0300;
const MARCA_DIACRITICA_MAX = 0x036f;

/**
 * Remove acentos (decompondo em NFD e descartando as marcas combinantes),
 * caixa, e colapsa espaço repetido — "Comércio"/"Comercio" normalizam pro
 * mesmo texto, e "Sala 08 - Loja 24"/"Sala 08   - Loja 24" (3 espaços, achado
 * real 2026-07-27 nos nomes de sala da Conexa: a mesma sala aparece com 1, 2
 * ou 3 espaços em faturas diferentes) também. Compartilhado entre
 * `clickup/mes-fields.ts` (nome de campo do ClickUp) e
 * `clickup/filtro-padroes.ts` (padrão de texto contra `servicoOuPlano`): as
 * duas comparações precisam da mesma regra, e o Postgres não ignora acento
 * nem espaço repetido por padrão (só maiúscula/minúscula com
 * `mode: "insensitive"`), então essa normalização precisa acontecer em JS,
 * não numa query `contains`.
 */
export function normalizarTexto(texto: string): string {
  const semAcento = Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < MARCA_DIACRITICA_MIN || code > MARCA_DIACRITICA_MAX;
    })
    .join("");
  return semAcento.trim().toLowerCase().replace(/\s+/g, " ");
}
