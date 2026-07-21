import "server-only";
import { getEnv } from "@/lib/env";

/**
 * Cliente HTTP para a tela ADMIN (web) do Conexa — NÃO é a API REST v2.
 *
 * Por quê: o filtro "Data de Crédito da Cobrança" (que o financeiro usa para
 * fechar o período de uma rodada) só existe nessa tela de export administrativa,
 * autenticada por sessão de usuário logado — não existe como filtro na API REST
 * documentada (ver docs/context/conexa-integration.md). Validado ao vivo contra
 * seahubcoworking.conexa.app em 2026-07-21: login por formulário (sem CSRF),
 * export via GET com `export=excel`, resposta = xlsx real (OOXML).
 *
 * Superfície de autenticação separada: usuário/senha reais (`CONEXA_WEB_USERNAME`/
 * `CONEXA_WEB_PASSWORD`), não um token permanente de API.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; skill-financeiro/1.0)";
const LOGIN_PATH = "/index.php?r=site/login";

export class ConexaWebError extends Error {}

function formatDateBR(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Extrai `CNXSESSID=...` de um ou mais headers Set-Cookie da resposta. */
function extractSessionCookie(res: Response): string | null {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const raw = getSetCookie ? getSetCookie.call(res.headers) : [res.headers.get("set-cookie") ?? ""];
  for (const header of raw) {
    const match = /CNXSESSID=[^;,\s]+/.exec(header);
    if (match) return match[0];
  }
  return null;
}

async function login(): Promise<string> {
  const env = getEnv();
  if (!env.CONEXA_WEB_USERNAME || !env.CONEXA_WEB_PASSWORD) {
    throw new ConexaWebError(
      "CONEXA_WEB_USERNAME/CONEXA_WEB_PASSWORD não configurados — necessários para baixar os exports do Conexa.",
    );
  }

  const body = new URLSearchParams({
    "LoginForm[username]": env.CONEXA_WEB_USERNAME,
    "LoginForm[password]": env.CONEXA_WEB_PASSWORD,
    "LoginForm[rememberMe]": "0",
    token: "",
  });

  const res = await fetch(`${env.CONEXA_BASE_URL}${LOGIN_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body,
    redirect: "manual",
  });

  const cookie = extractSessionCookie(res);
  // Login bem-sucedido no Conexa redireciona (302) para r=site/index. Se não veio
  // cookie, ou a resposta não foi um redirect, tratamos como falha de credenciais.
  if (!cookie || res.status !== 302) {
    throw new ConexaWebError(
      "Login no Conexa falhou — verifique CONEXA_WEB_USERNAME/CONEXA_WEB_PASSWORD (credenciais ou conta bloqueada).",
    );
  }
  return cookie;
}

async function fetchExport(cookie: string, params: Record<string, string>): Promise<Buffer> {
  const env = getEnv();
  const url = `${env.CONEXA_BASE_URL}/index.php?${new URLSearchParams(params).toString()}`;

  const res = await fetch(url, {
    headers: { cookie, "user-agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new ConexaWebError(`Falha ao baixar export do Conexa (HTTP ${res.status}).`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  // Sessão expirada/login falhou silenciosamente costuma voltar HTML (tela de
  // login) em vez do arquivo — nunca processar isso como se fosse a planilha.
  if (!contentType.includes("ms-excel") && !contentType.includes("spreadsheet")) {
    throw new ConexaWebError(
      `Export do Conexa não retornou um xlsx (content-type: "${contentType || "desconhecido"}"). ` +
        "Provável sessão expirada ou erro na tela do Conexa.",
    );
  }
  return buf;
}

const VENDA_FIXED_PARAMS: Record<string, string> = {
  "Venda[id]": "",
  "Venda[idCobranca]": "",
  "Venda[idEmpresaCliente]": "",
  "Venda[unidadeProdutoFilter]": "",
  "Venda[idUser]": "",
  "Venda[nomeRevendedor]": "",
  "Venda[idCliente]": "",
  "Venda[idProduto]": "",
  "Venda[idCategoriaServico]": "",
  "Venda[date_first]": "",
  "Venda[date_last]": "",
  "Venda[dataCompetenciaInicio]": "",
  "Venda[dataCompetenciaFim]": "",
  "Venda[criadaFilterFirst]": "",
  "Venda[criadaFilterLast]": "",
  "Venda[quantidade]": "",
  "Venda[valor]": "",
  "Venda[observacoes]": "",
  "Venda[dataFaturadaFirst]": "",
  "Venda[dataFaturadaLast]": "",
  "Venda[idVendaRecorrente]": "",
  ajax: "venda-grid",
  clearFilters: "0",
  isFiltering: "1",
  r: "venda/admin",
  searchText: "",
  show_all: "1",
  export: "excel",
};

const COBRANCA_FIXED_PARAMS: Record<string, string> = {
  "Cobranca[id]": "",
  "Cobranca[statusRegistroBanco]": "",
  "Cobranca[idCliente][]": "",
  "Cobranca[idRevendedor][]": "",
  "Cobranca[tipo]": "",
  "Cobranca[valor]": "",
  "Cobranca[vencFilterFirst]": "",
  "Cobranca[vencFilterLast]": "",
  "Cobranca[quitacaoFilterFirst]": "",
  "Cobranca[quitacaoFilterLast]": "",
  "Cobranca[operacaoQuitacaoFilterFirst]": "",
  "Cobranca[operacaoQuitacaoFilterLast]": "",
  "Cobranca[date_first]": "",
  "Cobranca[date_last]": "",
  "Cobranca[imprFilter]": "",
  "Cobranca[emissaoFilterFirst]": "",
  "Cobranca[emissaoFilterLast]": "",
  "Cobranca[avisosAnteriores]": "",
  "Cobranca[observacoes]": "",
  "Cobranca[nossoNumeroBoleto]": "",
  "Cobranca[apenasBoletos]": "",
  "Cobranca[temAnexo]": "",
  ajax: "cobranca-grid",
  clearFilters: "0",
  isFiltering: "1",
  r: "cobranca/admin",
  searchText: "",
  show_all: "1",
  export: "excel",
};

/** Baixa Listar Vendas filtrado por Data de Crédito da Cobrança (`Venda[creditoFilterFirst/Last]`). */
export async function fetchListarVendas(cookie: string, periodoInicio: Date, periodoFim: Date): Promise<Buffer> {
  return fetchExport(cookie, {
    ...VENDA_FIXED_PARAMS,
    "Venda[creditoFilterFirst]": formatDateBR(periodoInicio),
    "Venda[creditoFilterLast]": formatDateBR(periodoFim),
  });
}

/** Baixa Contas a Receber filtrado por Data de Crédito da Cobrança (`Cobranca[dataCreditoFilterFirst/Last]`). */
export async function fetchContasReceber(cookie: string, periodoInicio: Date, periodoFim: Date): Promise<Buffer> {
  return fetchExport(cookie, {
    ...COBRANCA_FIXED_PARAMS,
    "Cobranca[dataCreditoFilterFirst]": formatDateBR(periodoInicio),
    "Cobranca[dataCreditoFilterLast]": formatDateBR(periodoFim),
  });
}

/** Loga uma única vez e baixa os dois exports do período — uso normal de uma rodada. */
export async function fetchBothExports(
  periodoInicio: Date,
  periodoFim: Date,
): Promise<{ listarVendas: Buffer; contasReceber: Buffer }> {
  const cookie = await login();
  const listarVendas = await fetchListarVendas(cookie, periodoInicio, periodoFim);
  const contasReceber = await fetchContasReceber(cookie, periodoInicio, periodoFim);
  return { listarVendas, contasReceber };
}
