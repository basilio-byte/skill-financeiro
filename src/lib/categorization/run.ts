import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchBothExports } from "@/lib/conexa-web/client";
import { prepararRodada } from "@/lib/categorization/preparar";
import { regrasAtivasParaRodada } from "@/lib/categorization/regras-ativas";
import { persistLinhasCategorizadas, type PersistResumo } from "@/lib/categorization/persist";
import type { CategorizedLine } from "@/lib/categorization/types";
import { toAmountString } from "@/lib/money";
import { pushValoresDoMesCorrente } from "@/lib/clickup/push";

export class SincronizacaoEmAndamentoError extends Error {}

/**
 * P2034 (conflito de serialização) entre esta rodada e uma revisão manual
 * concorrente em /revisar (updateCategorizedLineAction, também Serializable —
 * é exatamente para isso que as duas são Serializable, ver persist.ts) é
 * transitório e ESPERADO sob uso normal, não uma falha real. Sem retry aqui,
 * a rodada inteira virava FAILED com o texto cru do Postgres por uma colisão
 * benigna (achado de auditoria 2026-07-23) — gerando ruído recorrente em
 * /runs que mascara falhas de verdade por "alarm fatigue".
 */
async function persistComRetry(
  runId: string,
  linhas: CategorizedLine[],
  periodoInicio: Date,
  periodoFim: Date,
): Promise<PersistResumo> {
  const MAX_TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      return await persistLinhasCategorizadas(runId, linhas, periodoInicio, periodoFim);
    } catch (err) {
      const isP2034 = (err as { code?: string })?.code === "P2034";
      if (!isP2034 || tentativa === MAX_TENTATIVAS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200 * tentativa));
    }
  }
  throw new Error("persistComRetry: inalcançável");
}

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
  origem?: "MANUAL" | "AUTOMATICO" | "IMPORTACAO";
  /** Importação manual: os dois exports entregues por uma pessoa, no lugar do download. */
  exportsManuais?: { listarVendas: Buffer; contasReceber: Buffer; entrada: Prisma.InputJsonValue };
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
            entradaManual: params.exportsManuais?.entrada,
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
    // Importação manual: os arquivos vieram de uma pessoa (que passou pelo captcha do
    // Conexa), então não há login nem download. O resto do caminho é idêntico.
    const { listarVendas, contasReceber } =
      params.exportsManuais ?? (await fetchBothExports(params.periodoInicio, params.periodoFim));

    const rules = await regrasAtivasParaRodada();
    const { resultado, somaValorRecebidoCR, diferencaConferencia } = prepararRodada({
      contasReceber,
      listarVendas,
      periodoInicio: params.periodoInicio,
      periodoFim: params.periodoFim,
      rules,
    });

    const persistResumo = await persistComRetry(run.id, resultado.linhas, params.periodoInicio, params.periodoFim);

    // Conferência (ADR-0018): calculada em prepararRodada. Diferente de zero é sinal de algo
    // estrutural — nunca ignorado silenciosamente (regra #8).
    if (!diferencaConferencia.isZero()) {
      console.error(
        `[run] CONFERÊNCIA NÃO FECHOU: soma Valor Recebido do CR aceito (${somaValorRecebidoCR.toString()}) ` +
          `difere da soma Valor Recebido Cat. das linhas (${resultado.totalRecebido.toString()}) em ` +
          `${diferencaConferencia.toString()} — ver /runs/${run.id}. Verificar se alguma fatura tem valor não interpretado.`,
      );
    }

    await prisma.revenueSyncRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        concluidoEm: new Date(),
        totalLinhasCR: resultado.totalLinhasCR,
        totalLinhasLV: resultado.totalLinhasLV,
        totalSemLV: resultado.totalSemLV,
        totalRecebido: toAmountString(resultado.totalRecebido),
        diferencaConferencia: toAmountString(diferencaConferencia),
        resumoPorCategoria: resultado.resumoPorCategoria as unknown as Prisma.InputJsonValue,
        totalLinhasNovas: persistResumo.totalLinhasNovas,
        totalLinhasAtualizadas: persistResumo.totalLinhasAtualizadas,
        totalLinhasOrfasPreservadas: persistResumo.totalLinhasOrfasPreservadas,
        totalFaturasComConflito: persistResumo.totalFaturasComConflito,
      },
    });

    // Integração ClickUp (ADR-0023) — espelha os totais recém-persistidos nas
    // tarefas vinculadas. Isolada de propósito: o ClickUp é só um espelho, e
    // uma falha aqui (token inválido, API fora do ar, rate limit) NUNCA pode
    // marcar esta rodada como FAILED nem reverter a categorização de receita,
    // que é o que importa de verdade. Loga o resumo (mesmo quando não há
    // nada pra fazer) — sem isso, confirmar que o push roda em TODA
    // sincronização (automática inclusive, não só manual) exigiria acesso
    // direto ao banco; com o log, dá pra ver isso direto nos logs do
    // servidor (Easypanel) a cada 15 min.
    try {
      const resumoClickUp = await pushValoresDoMesCorrente();
      if (resumoClickUp.vinculosAtivos > 0) {
        console.log(
          `[run] ClickUp: ${resumoClickUp.vinculosAtivos} vínculo(s) ativo(s) — ` +
            `${resumoClickUp.atualizados} atualizado(s), ${resumoClickUp.semMudanca} sem mudança, ` +
            `${resumoClickUp.falharam} falha(s).`,
        );
      }
    } catch (err) {
      console.error("[run] push para o ClickUp falhou (rodada em si concluiu normalmente):", err);
    }

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
