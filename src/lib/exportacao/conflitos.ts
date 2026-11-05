import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listarConflitos } from "@/lib/categorization/conflitos";
import { todayKey } from "@/lib/dates";
import { money, toAmountString, ZERO } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { ceder } from "./fila";
import { frescorDaReceita } from "./frescor";
import {
  ABA_DETALHE_CONFLITOS,
  contarLinhasDosConflitos,
  descreverPedidoConflitos,
  exigirTamanhoSuportado,
  filtrarPorClassificacao,
  juntarComBanco,
  montarAbasConflitos,
  nomeDoArquivoConflitos,
  resumirProblemas,
  validarPermissoesConflitos,
  type LeituraDoBanco,
  type LinhaDoBanco,
  type PedidoConflitos,
} from "./pasta-conflitos";
import { ExportacaoInconsistenteError, type Formato, type ResultadoExportacao, type UsuarioExport } from "./tipos";

/**
 * Exportação de CONFLITOS (ADR-0035), parte do servidor. Só LEITURA — nada aqui resolve, exclui ou re-chaveia linha
 * (isso é da tela Conflitos).
 *
 * A lista vem de `listarConflitos()`: a MESMA da tela /conflitos, sem refazer a detecção. Ela lê TODAS as linhas de
 * receita (é o comportamento da própria tela) e agrupa por (fatura, mês de crédito); a fila do despachante já limita a
 * uma exportação por vez, então chamá-la aqui não multiplica o custo.
 *
 * `LinhaConflito` não traz o mês nem a data de crédito, então há UMA leitura extra, por id, numa transação REPEATABLE
 * READ que também pergunta ao BANCO quantas linhas são e quanto somam (conferência de contagem e dinheiro contra o
 * banco). As duas leituras (a lista e a por id) não são a mesma transação — `listarConflitos` usa o cliente global —,
 * então `juntarComBanco` confere linha a linha que nada mudou entre elas: se mudou, vira erro ("tente de novo"), não
 * uma planilha com o mês de uma versão e o valor de outra.
 */

/** Ids por consulta: a lista de `IN (…)` não pode passar do limite de parâmetros do Postgres. */
const TAM_LOTE = 2000;

/**
 * Mês e data de crédito (e o que identifica a linha) dos ids pedidos, mais a contagem e a soma que o BANCO calcula para
 * eles. Exportada para a verificação contra dado real (`tamLote` pequeno exercita o caminho de vários lotes).
 */
export async function lerMesesDeCredito(ids: readonly string[], tamLote: number = TAM_LOTE): Promise<LeituraDoBanco> {
  if (ids.length === 0) return { porId: new Map(), contagem: 0, total: "0.00" };
  if (!Number.isInteger(tamLote) || tamLote < 1) throw new RangeError(`tamanho de lote inválido: ${tamLote}`);
  return prisma.$transaction(
    async (tx) => {
      const porId = new Map<string, LinhaDoBanco>();
      let contagem = 0;
      let total = ZERO;
      for (let i = 0; i < ids.length; i += tamLote) {
        const where = { id: { in: ids.slice(i, i + tamLote) } };
        const linhas = await tx.revenueCategorizedLine.findMany({
          where,
          select: { id: true, crConexaId: true, chaveLinha: true, mesCredito: true, dataCredito: true, valorRecebidoCat: true },
        });
        for (const r of linhas) {
          porId.set(r.id, {
            crConexaId: r.crConexaId,
            chaveLinha: r.chaveLinha,
            mesCredito: r.mesCredito,
            dataCredito: r.dataCredito,
            valorRecebidoCat: r.valorRecebidoCat.toFixed(2),
          });
        }
        // O SUM e o COUNT do próprio Postgres, na mesma transação: independentes da soma feita aqui em JavaScript.
        const agg = await tx.revenueCategorizedLine.aggregate({ where, _count: { _all: true }, _sum: { valorRecebidoCat: true } });
        contagem += agg._count._all;
        total = total.plus(money(agg._sum.valorRecebidoCat?.toString() ?? "0"));
      }
      return { porId, contagem, total: toAmountString(total) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
}

export async function gerarExportacaoConflitos(pedido: PedidoConflitos, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  // Antes de ler qualquer dado: só administrador (o despachante também confere; aqui não se depende dele).
  validarPermissoesConflitos(usuario);
  const agora = new Date();
  const hojeKey = todayKey();

  // 1) A lista da tela, restrita às classificações pedidas. Passou do teto? Erro com o que fazer, antes de ir ao banco de novo.
  const todos = await listarConflitos();
  await ceder();
  const selecionados = filtrarPorClassificacao(todos, pedido.classificacoes);
  exigirTamanhoSuportado(contarLinhasDosConflitos(selecionados), selecionados.length);

  // 2) Mês e data de crédito de cada linha (leitura por id, com contagem e soma do banco) e a atualidade da receita.
  const ids = selecionados.flatMap((c) => c.linhas.map((l) => l.id));
  const [leitura, frescorReceita] = await Promise.all([lerMesesDeCredito(ids), frescorDaReceita(agora)]);
  await ceder();

  // 3) 1ª conferência: a lista e o banco concordam (linha a linha, em contagem e em soma)? Divergência = o arquivo não sai.
  const junto = juntarComBanco(selecionados, leitura);
  if (junto.problemas.length) {
    throw new ExportacaoInconsistenteError(
      `Conferência com o banco não fechou — o arquivo não foi entregue. ${resumirProblemas(junto.problemas)}. ` +
        "Se um conflito foi resolvido ou uma sincronização rodou agora há pouco, tente de novo.",
    );
  }

  const pasta = montarAbasConflitos({
    conflitos: junto.conflitos,
    totalSemFiltro: todos.length,
    pedido,
    geradoEm: agora,
    usuario,
    frescor: {
      texto: `A lista é calculada na hora, sobre o ESTADO ATUAL das linhas de receita do banco (não é o retrato de uma rodada de sincronização). ${frescorReceita.texto}`,
      alerta: frescorReceita.alerta,
    },
  });
  await ceder();

  // 4) 2ª conferência: o ARQUIVO escrito (xlsx ou csv), lido de volta, tem as mesmas linhas e a mesma soma — em cada aba.
  const total = toAmountString(pasta.total);
  const entrega = await entregarAsync(pasta.abas, pasta.esperado, formato, ABA_DETALHE_CONFLITOS);

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoConflitos(pedido, hojeKey, entrega.extensao),
    contentType: entrega.contentType,
    linhas: pasta.nLinhas,
    total,
    filtros: descreverPedidoConflitos(pedido),
    // Cliente (razão social) e nome de quem revisou: o mesmo que a exportação de receita traz sem marcar como dado pessoal.
    // Não há CPF/CNPJ, contato nem texto livre do Conexa.
    dadosPessoais: false,
    filtrosJson: pedido,
  };
}
