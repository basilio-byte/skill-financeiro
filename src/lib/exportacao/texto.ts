/**
 * Texto que vai para uma célula de planilha. Puro.
 *
 * Três defeitos reais que isto fecha:
 *  1. Caracteres de controle (o campo Observações vem do Conexa, texto livre digitado por gente) são INVÁLIDOS em
 *     XML 1.0: um único `\u0008` faz o Excel abrir o arquivo em "modo de reparo" e descartar dados. Removidos.
 *  2. Substitutos (surrogates) soltos, idem.
 *  3. Uma célula do Excel aceita no máximo 32.767 caracteres; acima disso o Excel recusa/trunca sem avisar. Aqui o
 *     corte é explícito e marcado.
 *
 * (Injeção de fórmula NÃO é problema no .xlsx: o texto é gravado como string inline e nunca interpretado como
 * fórmula. No CSV é — ver `csv.ts`.)
 */

/** Controle exceto \t \n \r, mais U+FFFE e U+FFFF. */
const CONTROLE_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
/** Substituto alto sem baixo, ou baixo sem alto. */
const SUBSTITUTO_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const LIMITE_CELULA = 32_000;
const MARCA_CORTE = "… [texto cortado: passou do limite de uma célula do Excel]";

export function textoSeguro(valor: unknown, limite: number = LIMITE_CELULA): string {
  if (valor === null || valor === undefined) return "";
  const s = String(valor).replace(CONTROLE_XML, "").replace(SUBSTITUTO_SOLTO, "");
  if (s.length <= limite) return s;
  return s.slice(0, limite - MARCA_CORTE.length) + MARCA_CORTE;
}

const CONTROLE_XML_TESTE = new RegExp(CONTROLE_XML.source);
const SUBSTITUTO_SOLTO_TESTE = new RegExp(SUBSTITUTO_SOLTO.source);

/** O texto traz caractere que o XML 1.0 não aceita (controle, U+FFFE/U+FFFF ou substituto solto)? Sem estado (não usa `lastIndex`). */
export function temCaractereInvalido(s: string): boolean {
  return CONTROLE_XML_TESTE.test(s) || SUBSTITUTO_SOLTO_TESTE.test(s);
}
