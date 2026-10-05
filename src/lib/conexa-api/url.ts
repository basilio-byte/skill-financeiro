/**
 * Montagem de URL da API REST v2 do Conexa — pura (sem env), para ser testável.
 *
 * ⚠ A API v2 NÃO mora na raiz do site. `https://<sub>.conexa.app` é a tela admin
 * (HTML, login por formulário); a API fica em `.../index.php/api/v2`. Usar a raiz
 * devolve a página de login com HTTP 200 e o erro só aparece ao tentar parsear
 * JSON ("Unexpected token '<', <!DOCTYPE…") — foi exatamente o bug da ADR-0031 em
 * produção. Por isso a base da API é uma variável PRÓPRIA (CONEXA_API_BASE_URL) e
 * não reaproveita CONEXA_BASE_URL, que o cliente web usa para a tela admin.
 */

export type QueryValue = string | number | Array<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

/**
 * Regras da API (medidas no comercial), não do TypeScript: arrays com chave `[]`
 * exigem o parâmetro REPETIDO (`id[]=1&id[]=2`) — juntar com vírgula devolve em
 * silêncio o conjunto errado.
 */
export function montarUrl(base: string, path: string, query?: Query): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (k.endsWith("[]")) for (const x of v) url.searchParams.append(k, String(x));
      else if (v.length) url.searchParams.set(k, v.join(","));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** A base parece a da API v2? Barato e suficiente para falhar alto com a causa certa. */
export function baseParecidaComApi(base: string): boolean {
  return /\/api\/v\d+\/?$/.test(base.trim());
}
