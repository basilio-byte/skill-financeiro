import "server-only";
import { getEnv } from "@/lib/env";
import { computeAutoSyncWindow } from "@/lib/scheduler/auto-sync-window";
import { startCategorizationRun, SincronizacaoEmAndamentoError } from "@/lib/categorization/run";

export { computeAutoSyncWindow };

/** Dispara um tick da sincronização automática. Nunca deixa uma exceção
 * escapar — uma falha de rede/Conexa não pode derrubar o processo do servidor. */
export async function runAutoSyncTick(): Promise<void> {
  try {
    const { periodoInicio, periodoFim } = computeAutoSyncWindow();
    const runId = await startCategorizationRun({ periodoInicio, periodoFim, origem: "AUTOMATICO" });
    console.log(`[auto-sync] sincronização automática concluída (rodada ${runId}).`);
  } catch (err) {
    if (err instanceof SincronizacaoEmAndamentoError) {
      console.log("[auto-sync] pulando este tick — outra sincronização já está em andamento.");
      return;
    }
    console.error("[auto-sync] falha na sincronização automática:", err instanceof Error ? err.message : err);
  }
}

let agendado = false;

/**
 * Agenda a sincronização automática a cada `SYNC_INTERVAL_MINUTES` (default
 * 15 min) — ver ADR-0013. Roda um tick imediatamente no boot (não espera o
 * primeiro intervalo cheio) e depois se reagenda em loop, SEMPRE só após o
 * tick anterior terminar — nunca sobrepõe uma sincronização à outra, mesmo
 * que uma demore mais que o intervalo configurado.
 *
 * Chamada a partir de instrumentation.ts::register(), que o Next.js executa
 * uma única vez quando o processo do servidor sobe (inclusive no modo
 * standalone usado no Docker) — nunca durante `next build`.
 */
export function scheduleAutoSync(): void {
  if (agendado) return;
  agendado = true;

  const env = getEnv();
  if (!env.SYNC_AUTO_ENABLED) {
    console.log("[auto-sync] desabilitado (SYNC_AUTO_ENABLED=false) — nenhuma sincronização automática será agendada.");
    return;
  }

  const intervaloMs = env.SYNC_INTERVAL_MINUTES * 60_000;
  console.log(`[auto-sync] habilitado — sincronizando a cada ${env.SYNC_INTERVAL_MINUTES} min (mês corrente).`);

  const tick = () => {
    runAutoSyncTick().finally(() => {
      setTimeout(tick, intervaloMs);
    });
  };
  tick();
}
