/**
 * De ONDE o token pode vir — puro, sem banco.
 *
 * ⚠ Flexível de propósito. O conector personalizado da claude.ai reserva o cabeçalho
 * `Authorization` ao fluxo OAuth e só deixa escolher nomes como `x-api-key` (medido no
 * formulário em 2026-10-05); o Claude Code, por outro lado, usa `Authorization: Bearer`.
 * Um servidor que só aceitasse um dos dois ficaria inalcançável para metade dos clientes.
 *
 * Isso NÃO afrouxa a segurança: o que autentica é o token (prefixo + SHA-256 no banco),
 * seja qual for o cabeçalho que o carregou.
 */

/** Ordem de preferência. `authorization` primeiro; os demais são os nomes que o formulário oferece. */
export const CABECALHOS_DE_TOKEN = [
  "authorization",
  "x-mcp-token",
  "x-api-key",
  "api-key",
  "apikey",
  "x-apikey",
  "x-api-token",
  "api-token",
  "x-auth-token",
] as const;

/** Tira o "Bearer " (qualquer caixa) e as aspas/espaços que um formulário às vezes deixa. */
function limpar(valor: string): string {
  let v = valor.trim();
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, "");
  return v.trim().replace(/^"(.*)"$/, "$1").trim();
}

export function extrairToken(headers: { get(nome: string): string | null }): string {
  for (const nome of CABECALHOS_DE_TOKEN) {
    const bruto = headers.get(nome);
    if (!bruto) continue;
    const v = limpar(bruto);
    if (v) return v;
  }
  return "";
}

/**
 * O cliente quer um fluxo SSE (GET com `Accept: text/event-stream`, sem aceitar JSON)?
 * Pela especificação do transporte HTTP do MCP, o servidor que não oferece SSE deve
 * responder 405 — e o cliente então segue só com POST. Responder 200 com um JSON de
 * "cartão de visita" a um cliente que espera eventos o deixa esperando o que não vem.
 */
export function pedeFluxoSse(accept: string | null): boolean {
  if (!accept) return false;
  const a = accept.toLowerCase();
  return a.includes("text/event-stream") && !a.includes("application/json") && !a.includes("text/html") && !a.includes("*/*");
}
