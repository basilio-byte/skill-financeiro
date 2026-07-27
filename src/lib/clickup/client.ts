import "server-only";
import { getEnv } from "@/lib/env";
import { resolverCamposPorMes, type ClickUpField } from "@/lib/clickup/mes-fields";

/**
 * Cliente HTTP para a API v2 do ClickUp (ver ADR-0023) — usado só para
 * espelhar nos campos customizados de "Eficiência" os totais mensais já
 * calculados pelo skill-financeiro. Nunca lê o ClickUp como fonte de dado
 * financeiro, só escreve; o ClickUp nunca é fonte de verdade de nada aqui.
 *
 * Autenticação: header `Authorization: {token pessoal}` cru (sem "Bearer"),
 * confirmado contra a doc oficial e por exploração real da API em 2026-07-27.
 */

const BASE_URL = "https://api.clickup.com/api/v2";

// Bem abaixo de qualquer duração razoável de resposta da API — sem isto, uma
// chamada travada ao ClickUp (rede degradada, API fora do ar) nunca resolve
// nem rejeita, e como o push roda dentro da mesma rodada de sincronização
// (run.ts), isso arriscaria travar a sincronização de receita por causa de
// uma integração que é só um espelho (mesma lição da ADR-0020 sobre o
// Conexa, ver conexa-web/client.ts).
const FETCH_TIMEOUT_MS = 15_000;

export class ClickUpApiError extends Error {}

// IDs reais do ClickUp observados (exploração 2026-07-27): lista "901326339447"
// (numérico), tarefa "86ahe39fe" (alfanumérico minúsculo). Validar contra este
// formato ANTES de montar a URL fecha um vetor de path traversal encontrado em
// revisão adversarial: um `clickUpTaskId` digitado por um admin contendo "/"
// ou ".." mudaria o endpoint de verdade chamado (ex.: redirecionar de
// /task/{id}/field/{fieldId} para outro endpoint da mesma API), sempre usando
// o token compartilhado do servidor. "/" e "." nunca aparecem num ID real.
const ID_VALIDO_RE = /^[a-zA-Z0-9_-]+$/;

function validarId(id: string, rotulo: string): void {
  if (!ID_VALIDO_RE.test(id)) {
    throw new ClickUpApiError(`${rotulo} com formato inválido: "${id}".`);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const env = getEnv();
  if (!env.CLICKUP_API_TOKEN) {
    throw new ClickUpApiError("CLICKUP_API_TOKEN não configurado.");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: env.CLICKUP_API_TOKEN,
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const texto = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ClickUpApiError(`ClickUp API ${path} -> HTTP ${res.status}: ${texto.slice(0, 500)}`);
  }
  // Uma resposta 2xx com corpo vazio (204, ou 200 sem corpo) é válida — nunca
  // tentar JSON.parse("") às cegas (achado de revisão adversarial: derrubaria
  // um push que na verdade teve sucesso no ClickUp).
  if (!texto) return undefined;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ClickUpApiError(`ClickUp API ${path} -> resposta 2xx mas corpo não é JSON válido: ${texto.slice(0, 200)}`);
  }
}

/** Busca os campos customizados de uma lista e resolve os 12 campos de mês (ver mes-fields.ts). */
export async function getListFields(listId: string): Promise<Record<number, string>> {
  validarId(listId, "clickUpListId");
  const data = await api<{ fields: ClickUpField[] }>(`/list/${listId}/field`);
  return resolverCamposPorMes(data?.fields ?? []);
}

/**
 * Define o valor de um campo Currency/Number. Corpo `{ value: <número puro> }`
 * — confirmado na documentação oficial do ClickUp (setcustomfieldvalue): sem
 * wrapper nem string, um number literal.
 */
export async function setTaskFieldValue(taskId: string, fieldId: string, valor: number): Promise<void> {
  validarId(taskId, "clickUpTaskId");
  validarId(fieldId, "fieldId");
  await api(`/task/${taskId}/field/${fieldId}`, {
    method: "POST",
    body: JSON.stringify({ value: valor }),
  });
}
