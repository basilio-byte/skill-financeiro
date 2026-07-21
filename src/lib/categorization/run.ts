import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchBothExports } from "@/lib/conexa-web/client";
import { readXlsxAsObjects } from "@/lib/xlsx/reader";
import { parseContasReceberRows, parseListarVendasRows } from "@/lib/categorization/parse-exports";
import { categorizeInvoices } from "@/lib/categorization/categorize-invoices";
import { persistLinhasCategorizadas } from "@/lib/categorization/persist";
import { STATUS_ACEITOS_CR, STATUS_ACEITOS_LV } from "@/lib/categorization/types";
import { toAmountString } from "@/lib/money";

export class SincronizacaoEmAndamentoError extends Error {}

// Acima de qualquer duração real observada (~684 faturas processam em segundos a
// poucos minutos) — só existe para destravar depois de um crash do processo (ver
// abaixo), nunca para interromper uma rodada genuinamente em andamento.
const RODADA_TRAVADA_MS = 30 * 60_000;

/**
 * Dispara uma rodada completa: baixa os dois exports do Conexa (login web,
 * ver conexa-web/client.ts), categoriza e persiste via upsert por fatura
 * (ADR-0013 — cada bucket tem UMA linha atual, nunca linhas novas por rodada).
 * Cria o registro da rodada como RUNNING antes de qualquer chamada de rede,
 * para que falhas parciais fiquem registradas (nunca "sumam" silenciosamente).
 *
 * Nunca deixa duas sincronizações rodarem em paralelo (protege tanto contra o
 * agendador automático colidir com um disparo manual, quanto contra múltiplas
 * réplicas do container). "Já existe uma RUNNING?" + criar a nova são feitos na
 * MESMA transação Serializable — ler e depois gravar fora de transação seria um
 * TOCTOU (duas chamadas quase simultâneas podiam AMBAS ver "nenhuma rodando" e
 * competir por escrita nas mesmas linhas); Serializable faz o Postgres abortar
 * uma das duas com P2034, tratado abaixo como "já em andamento" (mesmo padrão
 * de `inSerializableGuard` em auth/user-actions.ts).
 *
 * Recuperação de rodada travada (achado por verificação adversarial): se o
 * processo morrer (OOM, restart do container) NO MEIO de uma rodada, o catch
 * abaixo que marcaria FAILED nunca roda — a rodada fica RUNNING para sempre,
 * e sem isso o guard acima bloquearia TODA sincronização futura (automática
 * e manual) permanentemente. Se a rodada RUNNING encontrada já é mais velha
 * que `RODADA_TRAVADA_MS`, ela é marcada FAILED aqui mesmo (com um `erro`
 * explicando o motivo) antes de liberar a nova.
 */
export async function startCategorizationRun(params: {
  periodoInicio: Date;
  periodoFim: Date;
  executadoPorId?: string;
  origem?: "MANUAL" | "AUTOMATICO";
}): Promise<string> {
  let run: { id: string };
  try {
    run = await prisma.$transaction(
      async (tx) => {
        const jaRodando = await tx.revenueSyncRun.findFirst({ where: { status: "RUNNING" } });
        if (jaRodando) {
          const idadeMs = Date.now() - jaRodando.iniciadoEm.getTime();
          if (idadeMs < RODADA_TRAVADA_MS) {
            throw new SincronizacaoEmAndamentoError(
              "Já existe uma sincronização em andamento — aguarde ela terminar antes de disparar outra.",
            );
          }
          await tx.revenueSyncRun.update({
            where: { id: jaRodando.id },
            data: {
              status: "FAILED",
              concluidoEm: new Date(),
              erro: `Rodada travada em RUNNING por mais de ${Math.round(RODADA_TRAVADA_MS / 60_000)} min (provável falha do processo antes de concluir) — marcada como falha automaticamente para liberar novas sincronizações.`,
            },
          });
        }
        return tx.revenueSyncRun.create({
          data: {
            periodoInicio: params.periodoInicio,
            periodoFim: params.periodoFim,
            status: "RUNNING",
            origem: params.origem ?? "MANUAL",
            executadoPorId: params.executadoPorId,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (err) {
    if (err instanceof SincronizacaoEmAndamentoError) throw err;
    if ((err as { code?: string })?.code === "P2034") {
      throw new SincronizacaoEmAndamentoError(
        "Outra sincronização começou ao mesmo tempo — aguarde ela terminar antes de disparar outra.",
      );
    }
    throw err;
  }

  try {
    const { listarVendas, contasReceber } = await fetchBothExports(params.periodoInicio, params.periodoFim);

    const crRowsAll = parseContasReceberRows(readXlsxAsObjects(contasReceber));
    const lvRowsAll = parseListarVendasRows(readXlsxAsObjects(listarVendas));

    const crRows = crRowsAll.filter((r) => STATUS_ACEITOS_CR.includes(r.status));
    const lvRows = lvRowsAll.filter((r) => STATUS_ACEITOS_LV.includes(r.status));

    const rules = await prisma.revenueCategoryRule.findMany({ where: { ativo: true } });
    const resultado = categorizeInvoices(
      crRows,
      lvRows,
      rules.map((r) => ({ nome: r.nome, categoria: r.categoria })),
    );

    const persistResumo = await persistLinhasCategorizadas(run.id, resultado.linhas);

    await prisma.revenueSyncRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        concluidoEm: new Date(),
        totalLinhasCR: resultado.totalLinhasCR,
        totalLinhasLV: resultado.totalLinhasLV,
        totalSemLV: resultado.totalSemLV,
        totalRecebido: toAmountString(resultado.totalRecebido),
        resumoPorCategoria: resultado.resumoPorCategoria as unknown as Prisma.InputJsonValue,
        totalLinhasNovas: persistResumo.totalLinhasNovas,
        totalLinhasAtualizadas: persistResumo.totalLinhasAtualizadas,
        totalLinhasOrfasPreservadas: persistResumo.totalLinhasOrfasPreservadas,
        totalFaturasComConflito: persistResumo.totalFaturasComConflito,
      },
    });

    return run.id;
  } catch (err) {
    await prisma.revenueSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        concluidoEm: new Date(),
        erro: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
