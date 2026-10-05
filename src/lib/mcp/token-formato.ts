import { createHash, randomBytes } from "node:crypto";

/**
 * O FORMATO DO TOKEN PESSOAL DO MCP — puro, sem banco.
 *
 * `shf_` + 43 caracteres base64url (32 bytes de entropia).
 *
 * ⚠ O prefixo não é enfeite. Ele deixa o token reconhecível num vazamento — um
 * `shf_` num log ou num repositório público é identificável como credencial
 * deste sistema, e ferramentas de varredura de segredo pegam padrões assim. E
 * ele separa, na autenticação, token pessoal de token master sem precisar
 * consultar o banco para o master.
 */
export const PREFIXO_TOKEN = "shf_";

/** Quantos caracteres do início ficam visíveis na tela, para identificação. */
const VISIVEL = PREFIXO_TOKEN.length + 6;

export function gerarToken(): string {
  return PREFIXO_TOKEN + randomBytes(32).toString("base64url");
}

/** SHA-256 em hex. É só isto que o banco guarda. */
export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** "shf_a1B2c3…" — o bastante para reconhecer, nunca para usar. */
export function prefixoVisivel(token: string): string {
  return token.slice(0, VISIVEL);
}

/** Tem cara de token pessoal? Filtro barato antes de ir ao banco. */
export function pareceTokenPessoal(valor: string): boolean {
  return /^shf_[A-Za-z0-9_-]{43}$/.test(valor);
}
