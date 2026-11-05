import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import { money, toAmountString } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { ceder } from "./fila";
import {
  abasDoFormato,
  conferirContagemExataDoArquivo,
  conferirContraBancoAcessos,
  defDaAba,
  descreverPedidoAcessos,
  filtroDeTempo,
  filtrosJsonAcessos,
  intervaloDosEventos,
  montarAbasAcessos,
  nomeDoArquivoAcessos,
  paraLinhaAcesso,
  paraLinhaConta,
  paraLinhaExportacao,
  paraLinhaMcp,
  paraLinhaToken,
  SELECT_ACESSO,
  SELECT_CONTA,
  SELECT_EXPORTACAO,
  SELECT_MCP,
  SELECT_TOKEN,
  validarPermissoesAcessos,
  verificarTeto,
  type AbaAcessos,
  type DadosAcessos,
  type PedidoAcessos,
  type ReferenciaBancoAcessos,
} from "./pasta-acessos";
import {
  ExportacaoInconsistenteError,
  ExportacaoInvalidaError,
  ExportacaoNegadaError,
  MAX_LINHAS,
  type Formato,
  type Papel,
  type ResultadoExportacao,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação de CONTAS, ACESSOS e AUDITORIA (ADR-0035), parte do servidor: lê `users`, `login_events`, `auditoria_mcp`,
 * `tokens_mcp` e `exportacoes_log` numa transação REPEATABLE READ (contagem e linhas de um MESMO retrato do banco) e
 * entrega o arquivo conferido. Só LEITURA — nada aqui escreve em lugar nenhum.
 *
 * Todo `select` vem de `pasta-acessos.ts` (SELECT_*): o hash da senha, o hash do token e os argumentos/detalhe do MCP
 * nunca são pedidos ao banco. O TypeScript completa a trava: o tipo do que a consulta devolve não tem esses campos.
 */

const TAM_LOTE = 2000;

// Desempate por id em toda ordenação: sem ele, linhas com o mesmo instante trocam de lugar entre lotes (skip/take).
const ORDEM_CONTAS: Prisma.UserOrderByWithRelationInput[] = [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }];
const ORDEM_ACESSOS: Prisma.LoginEventOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "asc" }];
const ORDEM_MCP: Prisma.AuditoriaMcpOrderByWithRelationInput[] = [{ quando: "desc" }, { id: "asc" }];
// Mesma ordem da tela de tokens: os ativos primeiro, depois os revogados; do mais novo para o mais antigo.
const ORDEM_TOKENS: Prisma.TokenMcpOrderByWithRelationInput[] = [{ revogadoEm: { sort: "asc", nulls: "first" } }, { criadoEm: "desc" }, { id: "asc" }];
const ORDEM_EXPORTACOES: Prisma.ExportacaoLogOrderByWithRelationInput[] = [{ quando: "desc" }, { id: "asc" }];

interface Condicoes {
  acessos: Prisma.LoginEventWhereInput;
  mcp: Prisma.AuditoriaMcpWhereInput;
  exportacoes: Prisma.ExportacaoLogWhereInput;
}

/** O filtro de data das três abas de eventos (Contas e Tokens não têm). A exportação e a prévia usam ESTA função. */
function condicoes(pedido: Pick<PedidoAcessos, "de" | "ate">): Condicoes {
  const tempo = filtroDeTempo(intervaloDosEventos(pedido));
  return {
    acessos: tempo ? { createdAt: tempo } : {},
    mcp: tempo ? { quando: tempo } : {},
    exportacoes: tempo ? { quando: tempo } : {},
  };
}

async function lerEmLotes<R>(contagem: number, buscar: (skip: number, take: number) => Promise<R[]>): Promise<R[]> {
  const todos: R[] = [];
  for (let skip = 0; skip < contagem; skip += TAM_LOTE) {
    for (const r of await buscar(skip, TAM_LOTE)) todos.push(r);
  }
  return todos;
}

export async function gerarExportacaoAcessos(pedido: PedidoAcessos, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  // A primeira coisa, antes de encostar no banco. O despachante e a rota também conferem; aqui se repete de propósito.
  validarPermissoesAcessos(pedido, usuario);
  const agora = new Date();
  const hojeKey = todayKey();
  const cond = condicoes(pedido);
  // O CSV leva só a aba principal: nem se lê o resto (poupa memória e não estoura o teto de uma aba que não sairia).
  const ids = abasDoFormato(pedido, formato);
  // Pedido sem aba nenhuma já é recusado por `lerPedidoAcessos`; aqui é só a trava de quem chamar o gerador direto.
  if (ids.length === 0) throw new ExportacaoInvalidaError(["Escolha ao menos uma aba para o arquivo."]);
  const quer = (id: AbaAcessos) => ids.includes(id);

  const leitura = await prisma.$transaction(
    async (tx) => {
      const ref: ReferenciaBancoAcessos = {};
      const contagens: Partial<Record<AbaAcessos, number>> = {};

      // 1) Contagens (e uma contagem independente por campo que vira rótulo) ANTES de carregar qualquer linha:
      //    o teto estoura cedo e barato, e a referência é do mesmo retrato do banco que as linhas.
      if (quer("contas")) {
        const contagem = await tx.user.count();
        contagens.contas = contagem;
        ref.contas = {
          contagem,
          ativas: await tx.user.count({ where: { isActive: true } }),
          administradores: await tx.user.count({ where: { role: "ADMIN" } }),
        };
      }
      if (quer("acessos")) {
        const contagem = await tx.loginEvent.count({ where: cond.acessos });
        contagens.acessos = contagem;
        ref.acessos = { contagem, sucessos: await tx.loginEvent.count({ where: { ...cond.acessos, success: true } }) };
      }
      if (quer("mcp")) {
        const contagem = await tx.auditoriaMcp.count({ where: cond.mcp });
        contagens.mcp = contagem;
        ref.mcp = { contagem, escritas: await tx.auditoriaMcp.count({ where: { ...cond.mcp, escrita: true } }) };
      }
      if (quer("tokens")) {
        const contagem = await tx.tokenMcp.count();
        contagens.tokens = contagem;
        ref.tokens = {
          contagem,
          revogados: await tx.tokenMcp.count({ where: { revogadoEm: { not: null } } }),
          comEscrita: await tx.tokenMcp.count({ where: { escopo: "ESCRITA" } }),
        };
      }
      if (quer("exportacoes")) {
        const contagem = await tx.exportacaoLog.count({ where: cond.exportacoes });
        contagens.exportacoes = contagem;
        const soma = await tx.exportacaoLog.aggregate({ where: cond.exportacoes, _sum: { total: true } });
        ref.exportacoes = {
          contagem,
          valor: toAmountString(money(soma._sum.total?.toString() ?? "0")),
          comDadosPessoais: await tx.exportacaoLog.count({ where: { ...cond.exportacoes, dadosPessoais: true } }),
        };
      }
      verificarTeto(contagens);

      // 2) As linhas, em lotes, só com as colunas de SELECT_*.
      const dados: DadosAcessos = {};
      if (ref.contas) {
        const registros = await lerEmLotes(ref.contas.contagem, (skip, take) => tx.user.findMany({ orderBy: ORDEM_CONTAS, skip, take, select: SELECT_CONTA }));
        dados.contas = registros.map(paraLinhaConta);
      }
      if (ref.acessos) {
        const registros = await lerEmLotes(ref.acessos.contagem, (skip, take) => tx.loginEvent.findMany({ where: cond.acessos, orderBy: ORDEM_ACESSOS, skip, take, select: SELECT_ACESSO }));
        dados.acessos = registros.map(paraLinhaAcesso);
      }
      if (ref.mcp) {
        const registros = await lerEmLotes(ref.mcp.contagem, (skip, take) => tx.auditoriaMcp.findMany({ where: cond.mcp, orderBy: ORDEM_MCP, skip, take, select: SELECT_MCP }));
        dados.mcp = registros.map(paraLinhaMcp);
      }
      if (ref.tokens) {
        const registros = await lerEmLotes(ref.tokens.contagem, (skip, take) => tx.tokenMcp.findMany({ orderBy: ORDEM_TOKENS, skip, take, select: SELECT_TOKEN }));
        dados.tokens = registros.map(paraLinhaToken);
      }
      if (ref.exportacoes) {
        const registros = await lerEmLotes(ref.exportacoes.contagem, (skip, take) =>
          tx.exportacaoLog.findMany({ where: cond.exportacoes, orderBy: ORDEM_EXPORTACOES, skip, take, select: SELECT_EXPORTACAO }),
        );
        dados.exportacoes = registros.map(paraLinhaExportacao);
      }
      return { dados, ref };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
  await ceder();

  // 1ª conferência: o que está em memória bate com o que o banco contou e somou, aba por aba, no mesmo retrato?
  const problemas = conferirContraBancoAcessos(leitura.dados, leitura.ref);
  if (problemas.length) throw new ExportacaoInconsistenteError(`Conferência com o banco não fechou — o arquivo não foi entregue. ${problemas.join("; ")}.`);

  const pasta = montarAbasAcessos({ dados: leitura.dados, pedido, formato, geradoEm: agora, usuario });
  await ceder();
  // 2ª conferência: o arquivo escrito (xlsx ou csv), relido. Um EsperadoNaAba por aba de dados.
  const entrega = await entregarAsync(pasta.abas, pasta.esperado, formato, pasta.principal);
  if (entrega.extensao === "xlsx") {
    // A leitura de volta do `entregar` acusa linha a menos nestas abas; esta acusa também linha a mais.
    const exata = conferirContagemExataDoArquivo(entrega.buffer, pasta.esperado);
    if (exata.length) throw new ExportacaoInconsistenteError(`Conferência de leitura do arquivo não fechou — o arquivo não foi entregue. ${exata.join("; ")}.`);
  }

  const filtros = descreverPedidoAcessos(pedido, formato);
  // O log guarda quantas linhas de dados SAÍRAM no arquivo (soma das abas entregues), e quantas em cada aba.
  filtros.push(["Linhas por aba", pasta.linhasPorAba.map((l) => `${l.nome}: ${l.linhas}`).join(" · ")]);

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoAcessos(pedido, hojeKey, entrega.extensao),
    contentType: entrega.contentType,
    linhas: pasta.nLinhas,
    total: null,
    filtros,
    // E-mail, IP e navegador estão em todas as abas: a exportação sempre leva dados pessoais.
    dadosPessoais: true,
    filtrosJson: filtrosJsonAcessos(pedido, formato),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Prévia (a tela)
// ---------------------------------------------------------------------------------------------------------------

export interface PreviaAcessos {
  /** Só as abas escolhidas, na ordem do catálogo. */
  abas: Array<{ id: AbaAcessos; nome: string; linhas: number; resumo: string }>;
  totalLinhas: number;
  acessos: { total: number; falhas: number } | null;
  mcp: { total: number; escritas: number } | null;
  exportacoes: { total: number; comDadosPessoais: number } | null;
  /** As abas que passam do teto de linhas (a exportação seria recusada). */
  acimaDoTeto: Array<{ nome: string; linhas: number }>;
}

/**
 * O que este recorte vai entregar, por aba — as MESMAS condições da exportação (`condicoes`), sem carregar linha nenhuma.
 * Fora de transação: é uma prévia, e a exportação é que confere contra um retrato único do banco.
 */
export async function previaAcessos(pedido: PedidoAcessos, papel: Papel): Promise<PreviaAcessos> {
  if (papel !== "ADMIN") throw new ExportacaoNegadaError("Contas, acessos e auditoria só podem ser consultados por administradores.");
  const cond = condicoes(pedido);
  const quer = (id: AbaAcessos) => pedido.abas.includes(id);

  const [contas, acessos, mcp, tokens, exportacoes] = await Promise.all([
    quer("contas") ? Promise.all([prisma.user.count(), prisma.user.count({ where: { isActive: true } })]) : null,
    quer("acessos") ? Promise.all([prisma.loginEvent.count({ where: cond.acessos }), prisma.loginEvent.count({ where: { ...cond.acessos, success: false } })]) : null,
    quer("mcp") ? Promise.all([prisma.auditoriaMcp.count({ where: cond.mcp }), prisma.auditoriaMcp.count({ where: { ...cond.mcp, escrita: true } })]) : null,
    quer("tokens") ? Promise.all([prisma.tokenMcp.count(), prisma.tokenMcp.count({ where: { revogadoEm: { not: null } } })]) : null,
    quer("exportacoes") ? Promise.all([prisma.exportacaoLog.count({ where: cond.exportacoes }), prisma.exportacaoLog.count({ where: { ...cond.exportacoes, dadosPessoais: true } })]) : null,
  ]);

  const abas: PreviaAcessos["abas"] = [];
  const poe = (id: AbaAcessos, linhas: number, resumo: string) => abas.push({ id, nome: defDaAba(id).nome, linhas, resumo });
  if (contas) poe("contas", contas[0], `${contas[1].toLocaleString("pt-BR")} ativa(s)`);
  if (acessos) poe("acessos", acessos[0], `${acessos[1].toLocaleString("pt-BR")} falha(s) de login`);
  if (mcp) poe("mcp", mcp[0], `${mcp[1].toLocaleString("pt-BR")} chamada(s) de escrita`);
  if (tokens) poe("tokens", tokens[0], `${tokens[1].toLocaleString("pt-BR")} revogado(s)`);
  if (exportacoes) poe("exportacoes", exportacoes[0], `${exportacoes[1].toLocaleString("pt-BR")} com dados pessoais`);

  return {
    abas,
    totalLinhas: abas.reduce((a, x) => a + x.linhas, 0),
    acessos: acessos ? { total: acessos[0], falhas: acessos[1] } : null,
    mcp: mcp ? { total: mcp[0], escritas: mcp[1] } : null,
    exportacoes: exportacoes ? { total: exportacoes[0], comDadosPessoais: exportacoes[1] } : null,
    acimaDoTeto: abas.filter((a) => a.linhas > MAX_LINHAS).map((a) => ({ nome: a.nome, linhas: a.linhas })),
  };
}
