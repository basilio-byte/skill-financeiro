import { AsyncLocalStorage } from "node:async_hooks";
import { ExportacaoCanceladaError, ExportacaoGrandeDemaisError, ExportacaoOcupadaError } from "./tipos";

/**
 * UMA exportação por vez por processo (ADR-0035).
 *
 * Por quê: gerar um arquivo grande custa centenas de MB de memória e alguns segundos de CPU, e o MESMO processo Node
 * serve o painel, a sincronização de 15 minutos e o MCP. Duas exportações grandes ao mesmo tempo seriam o caminho mais
 * curto para estourar a memória do contêiner e derrubar o painel inteiro. Exportações pequenas (um mês, ~1 mil linhas,
 * menos de meio segundo) passam pela fila sem que ninguém perceba.
 *
 * Quem chega com a fila já cheia recebe `ExportacaoOcupadaError` (503) em vez de esperar sem limite.
 *
 * CANCELAMENTO E PRAZO: quem desconecta (aba fechada, clique repetido) não vai receber o arquivo, então a tarefa não
 * começa (se ainda esperava na fila) ou para no próximo `ceder()` (se já rodava). E toda exportação tem um prazo
 * (`PRAZO_MS`): passou dele, para com um erro que diz o que fazer, em vez de segurar a fila e o processo indefinidamente.
 */

/** Quantas podem estar na fila (a que roda + as que esperam). */
export const MAX_NA_FILA = 4;

/** Tempo máximo de uma exportação, contado a partir de quando ela começa a rodar (não do tempo na fila). */
export const PRAZO_MS = 120_000;

interface Contexto {
  sinal?: AbortSignal;
  prazoEm: number;
}
const contexto = new AsyncLocalStorage<Contexto>();

export interface OpcoesDaFila {
  maxNaFila?: number;
  /** Sinal de cancelamento da requisição (o navegador desconectou). */
  sinal?: AbortSignal;
  prazoMs?: number;
}

let cauda: Promise<void> = Promise.resolve();
let naFila = 0;

export async function emExclusao<T>(fn: () => Promise<T>, opcoes: OpcoesDaFila | number = {}): Promise<T> {
  const { maxNaFila = MAX_NA_FILA, sinal, prazoMs = PRAZO_MS } = typeof opcoes === "number" ? { maxNaFila: opcoes } : opcoes;
  if (sinal?.aborted) throw new ExportacaoCanceladaError();
  if (naFila >= maxNaFila) throw new ExportacaoOcupadaError();
  naFila += 1;
  const anterior = cauda;
  let liberar!: () => void;
  cauda = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  try {
    await anterior;
    // Quem desconectou enquanto esperava a vez não gasta a vez de ninguém.
    if (sinal?.aborted) throw new ExportacaoCanceladaError();
    return await contexto.run({ sinal, prazoEm: Date.now() + prazoMs }, fn);
  } finally {
    naFila -= 1;
    liberar();
  }
}

/** Quantas estão na fila agora (só para teste e diagnóstico). */
export function tamanhoDaFila(): number {
  return naFila;
}

/**
 * Devolve o controle ao event loop. Chamado ENTRE as fases pesadas de uma exportação: cada fase continua síncrona,
 * mas o painel, a sincronização e o MCP respondem nos intervalos em vez de esperar o arquivo inteiro. É também o ponto
 * em que uma exportação cancelada (o navegador desconectou) ou fora do prazo PARA.
 */
export async function ceder(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const c = contexto.getStore();
  if (!c) return;
  if (c.sinal?.aborted) throw new ExportacaoCanceladaError();
  if (Date.now() > c.prazoEm) {
    throw new ExportacaoGrandeDemaisError(
      `A exportação passou de ${Math.round(PRAZO_MS / 1000)} segundos e foi interrompida. Reduza o recorte (um mês ou menos colunas) e tente de novo.`,
    );
  }
}
