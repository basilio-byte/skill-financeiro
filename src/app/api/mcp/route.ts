import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { atender, INFO_SERVIDOR, VERSAO_PROTOCOLO, textoDeErro, ERRO } from "@/lib/mcp/protocolo";
import { FERRAMENTAS, RESUMO_DAS_FERRAMENTAS } from "@/lib/mcp/servidor";
import type { ContextoMcp } from "@/lib/mcp/tipos";
import { autenticarTokenMcp, existeTokenAtivo } from "@/lib/mcp/tokens";
import { PREFIXO_TOKEN } from "@/lib/mcp/token-formato";
import { auditarRecusa, auditorDe } from "@/lib/mcp/auditoria";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * PORTA MCP DO PAINEL FINANCEIRO — JSON-RPC sobre HTTP, sem estado (ADR-0033).
 *
 *   claude mcp add --transport http --scope local seahub-financeiro \
 *     https://SEU-DOMINIO/api/mcp --header "Authorization: Bearer $TOKEN"
 *
 * ⚠ Só token PESSOAL (`shf_…`), criado em Minha conta. Não há token master por variável
 * de ambiente: as escritas precisam de uma pessoa a quem atribuir, e a rota nasce
 * FECHADA de verdade — sem nenhum token criado, responde 503 e nada autentica.
 *
 * ⚠ Sem SSE: toda resposta é um JSON só, e o servidor não guarda sessão (pode rodar
 * com mais de uma réplica).
 *
 * Esta rota está FORA do gate de sessão do middleware (autentica por conta própria).
 */

function naoAutorizado(motivo: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: ERRO.requisicaoInvalida, message: motivo } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="seahub-financeiro"' } },
  );
}

interface Autenticado {
  ok: true;
  ctx: ContextoMcp;
  somenteLeitura: boolean;
  motivoDaLeitura: "ambiente" | "token" | null;
}

async function autenticar(req: NextRequest): Promise<Autenticado | { ok: false; resposta: NextResponse }> {
  const travaDoAmbiente = getEnv().MCP_SOMENTE_LEITURA === "on";

  const cabecalho = req.headers.get("authorization") ?? "";
  const valor = cabecalho.toLowerCase().startsWith("bearer ") ? cabecalho.slice(7).trim() : (req.headers.get("x-mcp-token")?.trim() ?? "");
  // Rótulo que o CLIENTE declara; não autoriza nada — só distingue de onde veio.
  const cliente = req.headers.get("x-mcp-cliente")?.trim().slice(0, 40);

  if (!valor.startsWith(PREFIXO_TOKEN)) {
    if (!(await existeTokenAtivo())) {
      return {
        ok: false,
        resposta: NextResponse.json(
          { jsonrpc: "2.0", id: null, error: { code: ERRO.interno, message: "Nenhum token criado — rota fechada. Crie um token pessoal em Minha conta (administrador)." } },
          { status: 503 },
        ),
      };
    }
    return { ok: false, resposta: naoAutorizado("Falta o header Authorization: Bearer com um token pessoal (Minha conta → Tokens do MCP).") };
  }

  const id = await autenticarTokenMcp(valor);
  if (!id) return { ok: false, resposta: naoAutorizado("Token inválido, revogado ou de usuário inativo.") };

  const somenteLeitura = travaDoAmbiente || id.escopo === "LEITURA";
  return {
    ok: true,
    ctx: { quem: `${id.email} via MCP (${id.nomeDoToken}${cliente ? `, ${cliente}` : ""})`, origem: "MCP", userId: id.userId, tokenId: id.tokenId },
    somenteLeitura,
    motivoDaLeitura: travaDoAmbiente ? "ambiente" : id.escopo === "LEITURA" ? "token" : null,
  };
}

export async function POST(req: NextRequest) {
  const auth = await autenticar(req);
  if (!auth.ok) return auth.resposta;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: ERRO.parse, message: "JSON inválido." } }, { status: 400 });
  }

  const ferramentas = auth.somenteLeitura ? FERRAMENTAS.filter((f) => f.somenteLeitura) : FERRAMENTAS;
  const servidor = { ferramentas, contexto: auth.ctx, auditar: auditorDe(auth.ctx) };

  if (Array.isArray(corpo)) {
    // Lote: `ferramentas` já está filtrada, então escrita pedida por token de leitura
    // vira "ferramenta desconhecida" — nunca executa.
    const respostas = (await Promise.all(corpo.map((m) => atender(m, servidor)))).filter((r) => r !== null);
    return respostas.length ? NextResponse.json(respostas) : new NextResponse(null, { status: 202 });
  }

  // Escrita pedida por quem só pode ler: some de tools/list E a chamada direta recebe o
  // MOTIVO. Ferramenta que "não existe" quando existe manda o agente por caminhos
  // criativos para fazer a mesma coisa. A tentativa fica registrada.
  if (auth.somenteLeitura && ehChamadaDeEscrita(corpo)) {
    const nome = (corpo as { params?: { name?: string } }).params?.name ?? "";
    void auditarRecusa(auth.ctx, nome, auth.motivoDaLeitura === "token" ? "token somente leitura" : "MCP_SOMENTE_LEITURA=on");
    return NextResponse.json({
      jsonrpc: "2.0",
      id: (corpo as { id?: string | number }).id ?? null,
      result: textoDeErro(
        auth.motivoDaLeitura === "token"
          ? `A ferramenta "${nome}" escreve, e o seu token é SOMENTE LEITURA (ou o dono dele não é administrador). Crie um token com escopo de escrita em Minha conta, ou use a tela do painel.`
          : `A ferramenta "${nome}" escreve, e este servidor está com MCP_SOMENTE_LEITURA=on. Peça a quem administra o serviço para desligar a trava, ou use a tela do painel.`,
      ),
    });
  }

  const resposta = await atender(corpo, servidor);
  return resposta ? NextResponse.json(resposta) : new NextResponse(null, { status: 202 });
}

function ehChamadaDeEscrita(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { method?: string; params?: { name?: string } };
  if (m.method !== "tools/call" || !m.params?.name) return false;
  const f = FERRAMENTAS.find((x) => x.nome === m.params!.name);
  return !!f && !f.somenteLeitura;
}

/**
 * GET serve de cartão de visita, não de fluxo de eventos. A lista precisa ser a MESMA
 * que `tools/list` devolve: um cartão que anuncia mais ferramentas do que o protocolo
 * entrega manda quem integra procurar defeito no cliente dele.
 */
export async function GET(req: NextRequest) {
  const auth = await autenticar(req);
  const somenteLeitura = auth.ok ? auth.somenteLeitura : true;
  const expostas = somenteLeitura ? RESUMO_DAS_FERRAMENTAS.filter((f) => !f.escreve) : RESUMO_DAS_FERRAMENTAS;
  return NextResponse.json(
    {
      servidor: INFO_SERVIDOR,
      protocolo: VERSAO_PROTOCOLO,
      transporte: "http (JSON-RPC, sem SSE)",
      autenticado: auth.ok,
      identidade: auth.ok ? auth.ctx.quem : undefined,
      somenteLeitura,
      ferramentas: auth.ok ? expostas : undefined,
      comoUsar: 'claude mcp add --transport http --scope local seahub-financeiro <esta-url> --header "Authorization: Bearer <token de Minha conta>"',
    },
    // 503 quando a rota está FECHADA (nenhum token criado), 401 quando falta/errou o token:
    // o status é o mesmo que o POST devolveria, para o diagnóstico não mentir.
    { status: auth.ok ? 200 : auth.resposta.status },
  );
}
