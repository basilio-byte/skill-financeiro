/**
 * Leitura de parâmetros da URL, compartilhada por todos os conjuntos da central de exportação (ADR-0035). PURO.
 *
 * Princípio: valor malformado vira ERRO explícito (quem chama acumula em `erros`), nunca filtro ignorado em silêncio —
 * numa exportação, uma data digitada errada entregaria o banco inteiro como se fosse o recorte pedido.
 */

export type ParamsBrutos = Record<string, string | string[] | undefined>;

/**
 * Primeiro valor NÃO vazio, aparado ("" se ausente). Pular os vazios importa: `mes=&mes=2026-10` não pode virar "sem
 * filtro de mês" em silêncio (entregaria todos os meses como se fosse o recorte pedido).
 */
export const um = (v: string | string[] | undefined): string => {
  if (Array.isArray(v)) return v.map((x) => x.trim()).find((x) => x !== "") ?? "";
  return (v ?? "").trim();
};

/** Todos os valores, aparados, sem vazios nem duplicados, com teto de itens e de tamanho. */
export function lista(v: string | string[] | undefined, maxItens = 60, maxTam = 200): string[] {
  const brutos = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const saida: string[] = [];
  for (const x of brutos) {
    const t = x.trim().slice(0, maxTam);
    if (t && !saida.includes(t)) saida.push(t);
    if (saida.length >= maxItens) break;
  }
  return saida;
}

/** "yyyy-MM-dd" que EXISTE no calendário (2026-02-31 não vira março em silêncio) e é razoável (2000–2100). */
export function dataReal(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100) return false;
  const d = new Date(Date.UTC(a, mes - 1, dia));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function mesReal(s: string): boolean {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

/** "aaaa-mm-dd" → Date em meia-noite UTC (só chamar com data já validada). */
export const paraData = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** "2026-10-31" → "31/10/2026". */
export function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Decimal com PONTO e até 2 casas (nunca vírgula nem milhar: "25.000" viraria 25 reais). */
export const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/** Lê uma data opcional da URL; data inválida vira erro (e `null`). */
export function lerDataOpcional(params: ParamsBrutos, nome: string, rotulo: string, erros: string[]): string | null {
  const v = um(params[nome]);
  if (!v) return null;
  if (dataReal(v)) return v;
  erros.push(`${rotulo} inválida ("${v.slice(0, 20)}"): use uma data existente no formato aaaa-mm-dd.`);
  return null;
}

/**
 * Parâmetro de valor ÚNICO enviado mais de uma vez com valores DIFERENTES (`mes=2026-09&mes=2026-10`): `um()` pegaria o
 * primeiro e ignoraria o resto em silêncio — quem montou o link esperava outra coisa. Vira erro. Repetir o MESMO valor
 * (ou enviar valores em branco) é inofensivo.
 */
export function exigirUnicos(params: ParamsBrutos, nomes: readonly string[], erros: string[]): void {
  for (const nome of nomes) {
    const v = params[nome];
    if (!Array.isArray(v)) continue;
    const distintos = new Set(v.map((x) => x.trim()).filter((x) => x !== ""));
    if (distintos.size > 1) erros.push(`O parâmetro "${nome}" foi enviado ${distintos.size} vezes com valores diferentes: envie um só.`);
  }
}

/**
 * Interruptor "1"/"0" da URL (caixa de seleção do formulário). O valor EXPLÍCITO vale sempre, com ou sem `f=1`. Ausente
 * (ou em branco): desmarcada quando o formulário foi enviado (`f=1` — a caixa desmarcada some da URL) ou o `padrao`
 * quando é link direto/chamada programática. Qualquer outro valor é erro: nunca vira "ligado" por acaso.
 */
export function lerSimNao(params: ParamsBrutos, nome: string, rotulo: string, padrao: boolean, enviado: boolean, erros: string[]): boolean {
  const bruto = um(params[nome]);
  if (bruto === "1") return true;
  if (bruto === "0") return false;
  if (bruto !== "") erros.push(`${rotulo}: valor desconhecido ("${bruto.slice(0, 20)}"): use 1 ou 0.`);
  return enviado ? false : padrao;
}

/**
 * Caracteres que não podem chegar a uma exportação: os de controle (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F e o
 * DEL — o XML 1.0 não os aceita e o Excel abriria o arquivo em "modo de reparo"; o NUL ainda derruba a consulta no
 * Postgres) e os substitutos UTF-16 soltos. Tab, quebra de linha e retorno de carro são válidos e passam.
 */
const PROIBIDOS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Erro (400) para o parâmetro que traz caractere de controle — o valor NUNCA é repetido na mensagem. */
export function exigirTextoLimpo(params: ParamsBrutos, erros: string[]): void {
  for (const [nome, v] of Object.entries(params)) {
    const valores = Array.isArray(v) ? v : v === undefined ? [] : [v];
    if (valores.some((x) => PROIBIDOS.test(x))) {
      erros.push(`O parâmetro "${nome.replace(PROIBIDOS, "").slice(0, 30)}" tem caracteres de controle (acontece ao colar texto de Word ou PDF): apague o campo e digite de novo.`);
    }
  }
}

/** A validação comum de TODO conjunto: texto sem caractere de controle e parâmetros únicos sem valores conflitantes. */
export function validarParametros(params: ParamsBrutos, unicos: readonly string[], erros: string[]): void {
  exigirTextoLimpo(params, erros);
  exigirUnicos(params, unicos, erros);
}

/**
 * Escapa os curingas do LIKE/ILIKE do Postgres (`%` e `_`) e a própria barra. O Prisma passa o texto do `contains`
 * como veio, então `_` casaria QUALQUER caractere e `%` qualquer trecho: `cliente=__` devolvia o banco inteiro. Com isto a
 * busca é pelo texto LITERAL digitado (sem diferenciar maiúsculas; acentos e espaços contam).
 */
export const escaparLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
