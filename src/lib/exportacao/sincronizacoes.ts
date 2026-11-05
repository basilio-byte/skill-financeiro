import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import { money, toAmountString } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { ceder } from "./fila";
import { frescorDaReceita } from "./frescor";
import {
  chaveOrigemStatus,
  condicaoSincronizacoes,
  conferirContraBancoSinc,
  descreverPedidoSincronizacoes,
  exigirDentroDoTeto,
  montarAbasSincronizacoes,
  NOME_ABA_PRINCIPAL_SINC,
  nomeDoArquivoSincronizacoes,
  paraLinhaRodada,
  selecaoRodadas,
  validarPermissoesSincronizacoes,
  type LinhaRodada,
  type PedidoSincronizacoes,
  type ReferenciaBancoSinc,
  type RowRodada,
} from "./pasta-sincronizacoes";
import { ExportacaoInconsistenteError, MAX_LINHAS, type Formato, type ResultadoExportacao, type UsuarioExport } from "./tipos";

/**
 * Exportação do HISTÓRICO DE SINCRONIZAÇÕES (ADR-0035), parte do servidor. Só LEITURA de `revenue_sync_runs`: nada aqui
 * dispara sincronização, nem fala com o Conexa ou o ClickUp, nem escreve em receita.
 *
 * A leitura roda numa transação REPEATABLE READ: contagem, somas e as linhas vêm do MESMO instante, mesmo que um tick
 * de 15 minutos grave uma rodada nova no meio — e, por ser leitura, não bloqueia a sincronização. Em LOTES com
 * desempate por id (sem ele, rodadas com o mesmo instante trocariam de lugar entre lotes).
 */

const TAM_LOTE = 2000;

const ORDEM: Prisma.RevenueSyncRunOrderByWithRelationInput[] = [{ iniciadoEm: "desc" }, { id: "asc" }];

async function lerDoBanco(pedido: PedidoSincronizacoes, comTecnico: boolean): Promise<{ linhas: LinhaRodada[]; ref: ReferenciaBancoSinc }> {
  const where = condicaoSincronizacoes(pedido);
  const select = selecaoRodadas(comTecnico);
  return prisma.$transaction(
    async (tx) => {
      const contagem = await tx.revenueSyncRun.count({ where });
      exigirDentroDoTeto(contagem);
      const soma = await tx.revenueSyncRun.aggregate({
        where,
        _sum: {
          totalLinhasCR: true,
          totalLinhasLV: true,
          totalSemLV: true,
          totalLinhasNovas: true,
          totalLinhasAtualizadas: true,
          totalLinhasOrfasPreservadas: true,
          totalFaturasComConflito: true,
          totalRecebido: true,
          diferencaConferencia: true,
        },
      });
      const grupos = await tx.revenueSyncRun.groupBy({ by: ["origem", "status"], where, _count: { _all: true } });
      const comErro = await tx.revenueSyncRun.count({ where: { AND: [where, { erro: { not: null } }, { erro: { not: "" } }] } });

      // Em lotes, e cada lote vira texto simples na hora (os objetos Decimal do Prisma morrem aqui).
      const linhas: LinhaRodada[] = [];
      for (let skip = 0; skip < contagem; skip += TAM_LOTE) {
        const lote = await tx.revenueSyncRun.findMany({ where, select, orderBy: ORDEM, skip, take: TAM_LOTE });
        for (const r of lote as unknown as RowRodada[]) linhas.push(paraLinhaRodada(r, comTecnico));
      }

      const s = soma._sum;
      return {
        linhas,
        ref: {
          contagem,
          porOrigemStatus: new Map(grupos.map((g) => [chaveOrigemStatus(g.origem, g.status), g._count._all])),
          comErro,
          somaInteiros: {
            faturasCR: s.totalLinhasCR ?? 0,
            itensLV: s.totalLinhasLV ?? 0,
            semLV: s.totalSemLV ?? 0,
            linhasNovas: s.totalLinhasNovas ?? 0,
            linhasAtualizadas: s.totalLinhasAtualizadas ?? 0,
            orfasPreservadas: s.totalLinhasOrfasPreservadas ?? 0,
            faturasComConflito: s.totalFaturasComConflito ?? 0,
          },
          somaDinheiro: {
            totalRecebido: toAmountString(money(s.totalRecebido?.toString() ?? "0")),
            diferencaConferencia: toAmountString(money(s.diferencaConferencia?.toString() ?? "0")),
          },
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
}

export async function gerarExportacaoSincronizacoes(pedido: PedidoSincronizacoes, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  validarPermissoesSincronizacoes(pedido, usuario);
  const agora = new Date();
  const hojeKey = todayKey();
  const comTecnico = pedido.grupos.includes("tecnico");

  const leitura = await lerDoBanco(pedido, comTecnico);
  await ceder();

  // 1ª conferência: o que está em memória bate com o que o BANCO conta e soma pelo mesmo filtro?
  const doBanco = conferirContraBancoSinc(leitura.linhas, leitura.ref);
  if (doBanco.length) throw new ExportacaoInconsistenteError(`Conferência com o banco não fechou — o arquivo não foi entregue. ${doBanco.join("; ")}.`);

  const frescor = await frescorDaReceita(agora);
  const pasta = montarAbasSincronizacoes({
    linhas: leitura.linhas,
    // O CSV leva só o detalhe: não monta resumos que ninguém vai ler.
    pedido: formato === "csv" ? { ...pedido, resumos: false } : pedido,
    geradoEm: agora,
    usuario,
    frescor: { texto: frescor.texto, alerta: frescor.alerta },
    hoje: hojeKey,
  });
  await ceder();

  // 2ª conferência: o ARQUIVO escrito (xlsx ou csv), lido de volta. A aba principal não tem coluna de valor que soma
  // (dinheiro de rodadas diferentes não se soma): confere cabeçalho e número de linhas (`indiceValor` -1).
  const entrega = await entregarAsync(
    pasta.abas,
    [{ nomeAba: NOME_ABA_PRINCIPAL_SINC, titulos: pasta.titulosDasColunas, nLinhas: leitura.linhas.length, indiceValor: -1, total: null }],
    formato,
    NOME_ABA_PRINCIPAL_SINC,
  );

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoSincronizacoes(pedido, hojeKey, entrega.extensao),
    contentType: entrega.contentType,
    linhas: leitura.linhas.length,
    total: null,
    filtros: descreverPedidoSincronizacoes(pedido),
    // O grupo "tecnico" leva texto livre do sistema (erro, nomes de arquivo): conta como dado sensível no log.
    dadosPessoais: comTecnico,
    filtrosJson: pedido,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Prévia (tela): o que ESTE recorte vai entregar, antes de baixar
// ---------------------------------------------------------------------------------------------------------------

export interface PreviaSincronizacoes {
  rodadas: number;
  concluidas: number;
  falhas: number;
  emAndamento: number;
  outroStatus: number;
  /** Instante (não relógio de parede) da conclusão da última rodada concluída do recorte; null se não há. */
  ultimaConcluidaEm: Date | null;
  /** Passou do teto de linhas por exportação? */
  passaDoTeto: boolean;
}

export async function previaSincronizacoes(pedido: PedidoSincronizacoes): Promise<PreviaSincronizacoes> {
  const where = condicaoSincronizacoes(pedido);
  // Mesma leitura (REPEATABLE READ) para as contagens e a última concluída: os números da prévia fecham entre si.
  const { porStatus, ultimaConcluida } = await prisma.$transaction(
    async (tx) => ({
      porStatus: await tx.revenueSyncRun.groupBy({ by: ["status"], where, _count: { _all: true } }),
      ultimaConcluida: await tx.revenueSyncRun.findFirst({ where: { AND: [where, { status: "DONE" }] }, orderBy: { iniciadoEm: "desc" }, select: { iniciadoEm: true, concluidoEm: true } }),
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 },
  );
  const de = (status: string) => porStatus.find((g) => g.status === status)?._count._all ?? 0;
  const rodadas = porStatus.reduce((a, g) => a + g._count._all, 0);
  const concluidas = de("DONE");
  const falhas = de("FAILED");
  const emAndamento = de("RUNNING");
  return {
    rodadas,
    concluidas,
    falhas,
    emAndamento,
    outroStatus: rodadas - concluidas - falhas - emAndamento,
    ultimaConcluidaEm: ultimaConcluida ? (ultimaConcluida.concluidoEm ?? ultimaConcluida.iniciadoEm) : null,
    passaDoTeto: rodadas > MAX_LINHAS,
  };
}
