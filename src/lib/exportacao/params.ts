import type { ParamsBrutos } from "./filtros-receita";

/**
 * `URLSearchParams` → o formato que os parsers de filtro esperam: chave repetida vira lista (as caixas de seleção do
 * formulário enviam `categoria=A&categoria=B`). Puro.
 *
 * Objeto SEM protótipo e chaves perigosas descartadas: a chave vem da URL, que é entrada do usuário
 * (`__proto__=x` não pode tocar o protótipo de ninguém).
 */
const PROIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

export function paramsDe(sp: URLSearchParams): ParamsBrutos {
  const out = Object.create(null) as Record<string, string | string[]>;
  for (const [k, v] of sp.entries()) {
    if (PROIBIDAS.has(k)) continue;
    const atual = out[k];
    if (atual === undefined) out[k] = v;
    else if (Array.isArray(atual)) atual.push(v);
    else out[k] = [atual, v];
  }
  return out;
}

/** Query string a partir dos parâmetros crus, para devolver o usuário à tela com os filtros preservados. */
export function paraQueryString(p: ParamsBrutos, extra: Record<string, string> = {}, ignorar: string[] = []): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (ignorar.includes(k) || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) sp.append(k, x);
  }
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  return sp.toString();
}
