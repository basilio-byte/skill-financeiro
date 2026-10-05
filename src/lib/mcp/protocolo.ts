import { paraJsonSchema } from "./esquema";
import type { Ferramenta, ContextoMcp } from "./tipos";

/**
 * O PROTOCOLO MCP, no mínimo necessário — JSON-RPC 2.0 sobre HTTP.
 *
 * ⚠ Escrito à mão, e a decisão tem motivo. O SDK oficial traz um transporte
 * que quer o `http.ServerResponse` do Node, e o App Router do Next 15 entrega
 * `Request`/`Response` da Web. Encaixar os dois exige um adaptador, que é uma
 * dependência a mais no caminho do build do Docker — e o build do Docker é o
 * que publica este projeto. Um servidor **sem estado** de MCP é um `switch`
 * sobre seis métodos; o adaptador custaria mais que o switch.
 *
 * ⚠ **Sem estado, de propósito.** Cada requisição carrega tudo o que precisa e
 * o servidor não guarda sessão. Isso é o que permite o painel rodar com mais de
 * uma réplica no Easypanel sem uma sessão de MCP presa à réplica que a criou —
 * o mesmo raciocínio do ADR-0003 sobre o agendador.
 *
 * Esta camada é PURA: recebe a mensagem já decodificada, devolve a resposta.
 * Não sabe de HTTP, de cabeçalho nem de token. É o que a torna testável.
 */

export const VERSAO_PROTOCOLO = "2025-06-18";
/** Versões que sabemos atender. A negociação devolve a do cliente quando cabe. */
const VERSOES_ACEITAS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

export const INFO_SERVIDOR = {
  name: "seahub-financeiro",
  title: "Dashboard Financeiro Seahub",
  version: "1.0.0",
} as const;

/**
 * As instruções que o cliente de IA lê antes da primeira chamada.
 *
 * ⚠ Não é enfeite: é o único lugar que o cliente lê sem ser perguntado. Um agente
 * que não sabe que a receita está desatualizada vai afirmar o total de outubro com
 * a mesma confiança de um mês fechado — e o número sairá "certo" e velho.
 */
export const INSTRUCOES = `Dashboard Financeiro da Seahub Coworking — categorização de receita a partir do ERP Conexa, por Data de Crédito da Cobrança. Estas ferramentas consultam o que está NO BANCO do painel, não o Conexa ao vivo.

REGRAS DE OURO, que valem para toda resposta que você montar:

1. CONFIRA A FRESCOR ANTES DE AFIRMAR UM NÚMERO. Chame estado_do_sistema primeiro: se a sincronização de receita estiver falhando, os totais são um retrato antigo, e dizer "a receita de outubro é X" sem avisar isso é um erro. Receita é por DATA DE CRÉDITO (o dia em que o dinheiro cai), não por vencimento nem por pagamento.
2. DINHEIRO NUNCA É FLOAT. Os valores chegam como string decimal ("1234.56"). Some com cuidado e não arredonde no meio do caminho.
3. UMA FATURA PODE TER VÁRIAS LINHAS. Cada linha é um bucket de categoria dentro de uma fatura, por mês de crédito. Fatura recorrente ou parcelada tem uma linha por mês. Somar linhas de meses diferentes da mesma fatura NÃO é dupla contagem.
4. LINHA REVISADA MANUALMENTE (revisadoManualmente=true) tem categoria e valor CONGELADOS: a sincronização nunca os sobrescreve. O valor que a skill calculou fica em valorRecebidoCatOriginal. Se o Conexa mudou depois, o painel mostra o valor antigo de propósito.
5. A SINCRONIZAÇÃO DE RECEITA DEPENDE DO LOGIN WEB DO CONEXA, e o Conexa passou a exigir reCAPTCHA nele (2026-10-05). Enquanto isso valer, disparar_sincronizacao falha por captcha: não tente em laço e não tente contornar. A INADIMPLÊNCIA usa a API v2 e não é afetada.
6. REPROCESSAR UM MÊS FECHADO O RECATEGORIZA COM AS REGRAS DE HOJE: o total do mês pode não mudar, mas a quebra por categoria e as METAS mudam. Avise o usuário ANTES de disparar uma sincronização de período passado.
7. O status negotiated NÃO é inadimplência: é a cobrança substituída pela renegociação, e contá-la dobra a dívida.

ESCRITA: toda ferramenta que altera dado grava quem fez, com quais argumentos e o estado anterior (a linha excluída, o valor antigo) em auditoria_mcp. Leia antes de escrever e diga ao usuário exatamente o que vai mudar. Exclusões exigem confirmarExclusao=true: nunca passe isso sem o usuário ter confirmado a linha exata.

DESENVOLVIMENTO (código, deploy) NÃO é feito por este MCP: é pelo Claude Code, com git e testes. Aqui você obtém o que o código não tem, o estado vivo de produção.`;

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

export interface Requisicao {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface Resposta {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const ERRO = {
  parse: -32700,
  requisicaoInvalida: -32600,
  metodoDesconhecido: -32601,
  parametrosInvalidos: -32602,
  interno: -32603,
} as const;

const ok = (id: Requisicao["id"], result: unknown): Resposta => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const falha = (id: Requisicao["id"], code: number, message: string, data?: unknown): Resposta => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

// ---------------------------------------------------------------------------
// Atendimento
// ---------------------------------------------------------------------------

/** O que o gancho de auditoria recebe ao fim de CADA chamada de ferramenta. */
export interface EventoDeChamada {
  ferramenta: string;
  escrita: boolean;
  argumentos: Record<string, unknown>;
  /** ok = executou; erro = lançou; invalida = argumentos recusados pela validação. */
  resultado: "ok" | "erro" | "invalida";
  erro?: string;
  /** O estado ANTERIOR (ex.: a linha excluída) que a ferramenta devolveu em `_auditoria`. */
  detalhe?: unknown;
  duracaoMs: number;
}

export interface Servidor {
  ferramentas: Ferramenta[];
  contexto: ContextoMcp;
  /**
   * Gancho de auditoria. A camada de protocolo é PURA (não conhece banco), então
   * quem grava é injetado de fora. Nunca pode derrubar a chamada: erro aqui é
   * engolido por quem implementa.
   */
  auditar?: (e: EventoDeChamada) => void | Promise<void>;
}

/**
 * Uma ferramenta de escrita devolve, junto do resultado, o estado ANTERIOR sob a
 * chave `_auditoria`. Ela é separada aqui: vai para o rastro, não para o cliente
 * (que já recebe o que mudou no próprio resultado).
 */
function separarAuditoria(saida: unknown): { visivel: unknown; detalhe?: unknown } {
  if (saida !== null && typeof saida === "object" && !Array.isArray(saida) && "_auditoria" in saida) {
    const { _auditoria, ...resto } = saida as Record<string, unknown>;
    return { visivel: resto, detalhe: _auditoria };
  }
  return { visivel: saida };
}

/**
 * Atende uma mensagem. `null` = notificação, que por definição não responde.
 */
export async function atender(msg: unknown, servidor: Servidor): Promise<Resposta | null> {
  if (typeof msg !== "object" || msg === null) {
    return falha(null, ERRO.requisicaoInvalida, "Mensagem não é um objeto JSON-RPC.");
  }
  const req = msg as Requisicao;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return falha(req.id ?? null, ERRO.requisicaoInvalida, "Faltam `jsonrpc: \"2.0\"` ou `method`.");
  }

  // Notificação: sem `id`. Responder a uma notificação quebra clientes que não
  // esperam resposta.
  const ehNotificacao = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize": {
      const pedida = (req.params?.protocolVersion as string | undefined) ?? VERSAO_PROTOCOLO;
      return ok(req.id, {
        protocolVersion: VERSOES_ACEITAS.has(pedida) ? pedida : VERSAO_PROTOCOLO,
        capabilities: {
          // `listChanged: false` é honesto: a lista de ferramentas é estática
          // dentro de um processo. Anunciar `true` sem nunca emitir a
          // notificação faria o cliente esperar por um aviso que não vem.
          tools: { listChanged: false },
        },
        serverInfo: INFO_SERVIDOR,
        instructions: INSTRUCOES,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ehNotificacao ? null : ok(req.id, {});

    case "tools/list":
      return ok(req.id, {
        tools: servidor.ferramentas.map(descrever),
      });

    case "tools/call":
      return chamar(req, servidor);

    // Anunciamos só `tools`, mas clientes sondam estes dois assim mesmo.
    // Responder lista vazia é mais educado que -32601 num log de erro.
    case "resources/list":
      return ok(req.id, { resources: [] });
    case "resources/templates/list":
      return ok(req.id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(req.id, { prompts: [] });

    default:
      if (ehNotificacao) return null;
      return falha(req.id, ERRO.metodoDesconhecido, `Método desconhecido: ${req.method}`);
  }
}

function descrever(f: Ferramenta) {
  return {
    name: f.nome,
    title: f.titulo,
    description: f.descricao,
    inputSchema: paraJsonSchema(f.entrada),
    annotations: {
      title: f.titulo,
      readOnlyHint: f.somenteLeitura,
      destructiveHint: f.destrutiva ?? false,
      // Idempotente = repetir a chamada não muda mais nada. Vale para leitura
      // e para os upserts de configuração.
      idempotentHint: f.somenteLeitura || (f.idempotente ?? false),
      openWorldHint: f.mundoAberto ?? false,
    },
  };
}

async function chamar(req: Requisicao, servidor: Servidor): Promise<Resposta> {
  const nome = req.params?.name;
  if (typeof nome !== "string") {
    return falha(req.id, ERRO.parametrosInvalidos, "`params.name` é obrigatório.");
  }
  const f = servidor.ferramentas.find((x) => x.nome === nome);
  if (!f) {
    return falha(
      req.id,
      ERRO.parametrosInvalidos,
      `Ferramenta desconhecida: ${nome}. Use tools/list para ver as disponíveis.`,
    );
  }

  const bruto = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
  const inicio = Date.now();
  const auditar = (e: Omit<EventoDeChamada, "ferramenta" | "escrita" | "argumentos" | "duracaoMs">) => {
    if (!servidor.auditar) return;
    // Nunca deixa a auditoria atrasar nem derrubar a resposta.
    Promise.resolve(
      servidor.auditar({ ferramenta: nome, escrita: !f.somenteLeitura, argumentos: bruto, duracaoMs: Date.now() - inicio, ...e }),
    ).catch((err) => console.error("[mcp] falha ao gravar auditoria:", err));
  };
  const validado = f.entrada.safeParse(bruto);
  if (!validado.success) {
    auditar({ resultado: "invalida", erro: validado.error.issues.map((i) => i.message).join("; ").slice(0, 300) });
    // ⚠ Erro de validação volta como RESULTADO com `isError`, e não como erro
    // JSON-RPC. A diferença importa: erro de protocolo o cliente esconde do
    // modelo, e o modelo repete a mesma chamada errada para sempre. Como
    // resultado, ele lê o que faltou e corrige na tentativa seguinte.
    return ok(req.id, textoDeErro(
      `Argumentos inválidos para ${nome}:\n` +
        validado.error.issues
          .map((i) => `  · ${i.path.join(".") || "(raiz)"}: ${i.message}`)
          .join("\n"),
    ));
  }

  try {
    const saida = await f.executar(validado.data, servidor.contexto);
    const { visivel, detalhe } = separarAuditoria(saida);
    auditar({ resultado: "ok", detalhe });
    return ok(req.id, resultado(visivel));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    auditar({ resultado: "erro", erro: msg.slice(0, 500) });
    return ok(req.id, textoDeErro(msg));
  }
}

/**
 * Empacota o retorno de uma ferramenta.
 *
 * ⚠ `content` em texto E `structuredContent` juntos, sempre. Clientes antigos
 * só leem `content`; os novos preferem o estruturado. Mandar só um dos dois
 * funciona no cliente que você testou e falha no do colega.
 */
export function resultado(saida: unknown): Record<string, unknown> {
  const texto =
    typeof saida === "string" ? saida : JSON.stringify(saida, substituir, 2);
  const r: Record<string, unknown> = {
    content: [{ type: "text", text: texto }],
    isError: false,
  };
  if (saida !== null && typeof saida === "object" && !Array.isArray(saida)) {
    r.structuredContent = JSON.parse(JSON.stringify(saida, substituir));
  }
  return r;
}

export function textoDeErro(mensagem: string): Record<string, unknown> {
  return { content: [{ type: "text", text: mensagem }], isError: true };
}

/**
 * ⚠ `Decimal` do Prisma e `BigInt` não sobrevivem a `JSON.stringify` do jeito
 * que se espera: o primeiro vira `{"s":1,"e":2,...}` e o segundo lança
 * `TypeError`. Dinheiro virar objeto de três letras num MCP é como um número
 * errado chega a um relatório.
 */
function substituir(_chave: string, valor: unknown): unknown {
  if (typeof valor === "bigint") return Number(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (
    valor !== null &&
    typeof valor === "object" &&
    "toFixed" in valor &&
    typeof (valor as { toFixed: unknown }).toFixed === "function" &&
    "toString" in valor
  ) {
    // Decimal.js: string preserva a precisão que o float perderia.
    return (valor as { toString(): string }).toString();
  }
  return valor;
}
