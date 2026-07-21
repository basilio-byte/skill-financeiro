/**
 * Hook de boot do Next.js (roda uma vez quando o servidor sobe, inclusive no
 * modo standalone do Docker — nunca durante `next build`). Usado só para
 * agendar a sincronização automática (ADR-0013) — ver src/lib/scheduler/auto-sync.ts.
 *
 * `NEXT_RUNTIME === "nodejs"` evita registrar duas vezes quando o Next
 * também prepara um runtime edge (middleware) no mesmo processo.
 *
 * try/catch aqui é deliberado (achado por verificação adversarial): se
 * `register()` lançar, o Next.js pode nunca terminar de preparar o servidor
 * — TODA requisição passaria a falhar, não só a sincronização automática.
 * `scheduleAutoSync()` chama `getEnv()`, que valida o schema INTEIRO de
 * variáveis de ambiente (não só as de sync) — uma variável não relacionada
 * mal configurada (ex.: SESSION_SECRET curto) não pode derrubar o app
 * inteiro por causa de uma feature que nem é a sincronização.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { scheduleAutoSync } = await import("@/lib/scheduler/auto-sync");
      scheduleAutoSync();
    } catch (err) {
      console.error(
        "[instrumentation] falha ao iniciar o agendador automático — app segue no ar sem sincronização automática:",
        err,
      );
    }
  }
}
