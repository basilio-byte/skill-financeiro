import "server-only";
import { getEnv } from "@/lib/env";

/**
 * Cliente da API REST v2 do Conexa — ADR-0031.
 *
 * ============================ SOMENTE LEITURA ============================
 * `conexaGet` tem o método fixo em GET e NÃO expõe `method` nem `body`: não existe
 * caminho de código capaz de escrever no Conexa. É a mesma garantia estrutural do
 * dash comercial, de onde este cliente foi portado — enxuto de propósito (só o
 * que a inadimplência precisa: GET, paginação, limitador, retry em 429/5xx).
 * ========================================================================
 *
 * Distinto de `conexa-web/client.ts`, que loga na tela admin para usar o filtro
 * de Data de Crédito. Os dois NÃO se misturam: credenciais, superfície e modos de
 * falha diferentes.
 */

export class ConexaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConexaApiError";
  }
}

type QueryValue = string | number | Array<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

interface Pagina<T> {
  data?: T[];
  pagination?: { hasNext?: boolean };
}

const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Limitador serializado por PROCESSO. Vive em `globalThis` porque o Next empacota
 * route handlers e server actions em bundles separados — um `let` de módulo viraria
 * dois limitadores independentes, cada um dentro do teto e juntos acima dele (bug
 * real registrado no comercial).
 */
const CHAVE = Symbol.for("seahub.financeiro.conexa-api.limiter");
type Estado = { fila: Promise<void>; ultimo: number };
function estado(): Estado {
  const g = globalThis as typeof globalThis & { [CHAVE]?: Estado };
  return (g[CHAVE] ??= { fila: Promise.resolve(), ultimo: 0 });
}

async function agendar<T>(tarefa: () => Promise<T>): Promise<T> {
  const intervalo = Math.ceil((60_000 / getEnv().CONEXA_API_RATE_LIMIT_PER_MIN) * 1.05);
  const e = estado();
  const vez = e.fila.then(async () => {
    const espera = e.ultimo + intervalo - Date.now();
    if (espera > 0) await sleep(espera);
    e.ultimo = Date.now();
  });
  e.fila = vez.catch(() => {});
  return vez.then(tarefa);
}

/**
 * Serialização de query. Regras da API (medidas no comercial), não do TypeScript:
 * arrays com chave `[]` exigem o parâmetro REPETIDO (`id[]=1&id[]=2`) — juntar com
 * vírgula devolve em silêncio o conjunto errado. Exportada para teste.
 */
export function montarUrl(path: string, query?: Query): string {
  const base = getEnv().CONEXA_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
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

export async function conexaGet<T>(path: string, query?: Query): Promise<T> {
  const env = getEnv();
  if (!env.CONEXA_API_TOKEN) throw new ConexaApiError("CONEXA_API_TOKEN ausente.", 401);
  const url = montarUrl(path, query);

  for (let tentativa = 1; ; tentativa++) {
    let res: Response;
    try {
      res = await agendar(async () => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
        try {
          return await fetch(url, {
            method: "GET", // fixo — ver o bloco SOMENTE LEITURA no topo
            headers: { Authorization: `Bearer ${env.CONEXA_API_TOKEN}`, Accept: "application/json" },
            signal: ctl.signal,
            cache: "no-store",
          });
        } finally {
          clearTimeout(t);
        }
      });
    } catch (err) {
      if (tentativa <= MAX_RETRIES) {
        await sleep(Math.min(30_000, 2 ** tentativa * 500));
        continue;
      }
      throw new ConexaApiError(
        `GET ${path}: rede falhou após ${tentativa} tentativas (${err instanceof Error ? err.message : err})`,
        0,
      );
    }

    if (res.status === 429 && tentativa <= MAX_RETRIES) {
      const reset = Number(res.headers.get("X-Rate-Limit-Reset") ?? res.headers.get("Retry-After") ?? 60);
      await sleep((Number.isFinite(reset) ? reset : 60) * 1000 + 250);
      continue;
    }
    if (res.status >= 500 && tentativa <= MAX_RETRIES) {
      await sleep(Math.min(30_000, 2 ** tentativa * 500));
      continue;
    }
    // 4xx (inclusive 401/403) sobe direto: insistir com token inválido só gasta cota.
    if (!res.ok) throw new ConexaApiError(`GET ${path} → HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }
}

/**
 * Percorre TODAS as páginas de um recurso e devolve tudo. Fim da listagem:
 * `pagination.hasNext` (o sinal documentado); `itens.length < limit` só é fallback.
 * Falha em qualquer página LANÇA — quem chama nunca recebe uma lista parcial
 * achando que é completa.
 */
export async function listarTudo<T>(path: string, query: Query = {}): Promise<T[]> {
  const limit = 100;
  const out: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const pag = await conexaGet<Pagina<T> | T[]>(path, { ...query, limit, offset });
    const itens = Array.isArray(pag) ? pag : (pag.data ?? []);
    out.push(...itens);
    const hasNext = Array.isArray(pag) ? undefined : pag.pagination?.hasNext;
    if (hasNext === false) break;
    if (hasNext === undefined && itens.length < limit) break;
    if (itens.length === 0) break; // proteção contra laço infinito
    if (offset > 200_000) throw new ConexaApiError(`GET ${path}: paginação passou de 200 mil registros`, 0);
  }
  return out;
}

/** Busca por ID explícito, em lotes de 100 (`id[]`). */
export async function buscarPorIds<T>(path: string, ids: number[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const pag = await conexaGet<Pagina<T> | T[]>(path, { "id[]": ids.slice(i, i + 100), limit: 100, offset: 0 });
    out.push(...(Array.isArray(pag) ? pag : (pag.data ?? [])));
  }
  return out;
}
