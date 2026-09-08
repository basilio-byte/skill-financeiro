import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { computeAutoSyncWindow, computeCarenciaWindow } from "@/lib/scheduler/auto-sync-window";
import { startCategorizationRun, SincronizacaoEmAndamentoError } from "@/lib/categorization/run";

export { computeAutoSyncWindow, computeCarenciaWindow };

/** Dispara uma rodada e engole falhas — nenhuma sincronização pode derrubar o
 * processo do servidor. Devolve o id da rodada, ou null se não rodou. */
async function dispararRodada(
  rotulo: string,
  janela: { periodoInicio: Date; periodoFim: Date },
): Promise<string | null> {
  try {
    const runId = await startCategorizationRun({ ...janela, origem: "AUTOMATICO" });
    console.log(`[auto-sync] ${rotulo} concluída (rodada ${runId}).`);
    return runId;
  } catch (err) {
    if (err instanceof SincronizacaoEmAndamentoError) {
      console.log(`[auto-sync] pulando ${rotulo} — outra sincronização já está em andamento.`);
      return null;
    }
    console.error(`[auto-sync] falha em ${rotulo}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * A carência (mês anterior, ADR-0030) precisa rodar RARO, não a cada tick: o
 * objetivo é capturar baixa retroativa lançada nos primeiros dias do mês, e
 * isso não tem urgência de 15 minutos. Rodar junto de toda sincronização
 * dobraria os logins e os exports pedidos ao Conexa — um sistema de terceiro —
 * por 10 dias de cada mês, sem ganho nenhum.
 *
 * O "quando foi a última" vem do BANCO (`revenueSyncRun`), não de uma variável
 * em memória: o processo do Next reinicia a cada deploy, e um contador em
 * memória faria a carência rodar de novo a cada restart. Consulta por
 * `periodoInicio` exato — a rodada do mês corrente usa outro `periodoInicio`,
 * então não há como uma ser confundida com a outra. Uma sincronização MANUAL do
 * mesmo mês também conta (e deve mesmo contar: acabou de atualizar o dado).
 */
async function carenciaEstaVencida(periodoInicio: Date, intervaloMinutos: number): Promise<boolean> {
  const ultima = await prisma.revenueSyncRun.findFirst({
    where: { periodoInicio },
    orderBy: { iniciadoEm: "desc" },
    select: { iniciadoEm: true },
  });
  if (!ultima) return true;
  return Date.now() - ultima.iniciadoEm.getTime() >= intervaloMinutos * 60_000;
}

/**
 * Dispara um tick da sincronização automática: SEMPRE o mês corrente e, durante
 * os primeiros dias do mês, também o mês anterior (ADR-0030).
 *
 * As duas rodadas são SEQUENCIAIS e SEPARADAS, nunca uma janela ampla só — ver
 * o comentário de `computeCarenciaWindow`: uma rodada emite uma parcela por
 * fatura, então uma janela cruzando dois meses deixaria o mês corrente sem
 * atualização. Sequenciais também porque `startCategorizationRun` recusa duas
 * rodadas simultâneas (guard Serializable); disparar as duas em paralelo faria
 * a segunda ser sempre descartada.
 *
 * A carência roda DEPOIS do mês corrente de propósito: se só der tempo de uma,
 * a que importa mais é a do mês em que o dinheiro está entrando agora.
 */
export async function runAutoSyncTick(): Promise<void> {
  try {
    await dispararRodada("sincronização automática (mês corrente)", computeAutoSyncWindow());
  } catch (err) {
    console.error("[auto-sync] falha inesperada no mês corrente:", err instanceof Error ? err.message : err);
  }

  try {
    const env = getEnv();
    const carencia = computeCarenciaWindow(undefined, env.SYNC_CARENCIA_DIAS);
    if (!carencia) return;
    if (!(await carenciaEstaVencida(carencia.periodoInicio, env.SYNC_CARENCIA_INTERVALO_MINUTOS))) return;

    const mes = carencia.periodoInicio.toISOString().slice(0, 7);
    await dispararRodada(`carência do mês anterior (${mes})`, carencia);
  } catch (err) {
    // A carência é um complemento: uma falha aqui NUNCA pode afetar a
    // sincronização do mês corrente, que já rodou acima.
    console.error("[auto-sync] falha na carência do mês anterior:", err instanceof Error ? err.message : err);
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
  console.log(
    `[auto-sync] habilitado — sincronizando a cada ${env.SYNC_INTERVAL_MINUTES} min (mês corrente); ` +
      `mês anterior reprocessado nos primeiros ${env.SYNC_CARENCIA_DIAS} dia(s) do mês, ` +
      `no máximo a cada ${env.SYNC_CARENCIA_INTERVALO_MINUTOS} min.`,
  );

  const tick = () => {
    runAutoSyncTick().finally(() => {
      setTimeout(tick, intervaloMs);
    });
  };
  tick();
}
