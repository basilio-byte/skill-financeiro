import "server-only";
import { prisma } from "@/lib/db";
import { ceder } from "./fila";
import { ExportacaoInconsistenteError } from "./tipos";

/**
 * Leitura em vários passos com a receita PARADA (ADR-0035). Alguns conjuntos (Metas) apuram o mesmo ano em muitas
 * consultas independentes, que não cabem numa transação só (o cálculo é o `buildMetas` da tela, que usa o cliente
 * global). Se a sincronização de 15 minutos gravar no meio, o mês apurado antes e o trimestre apurado depois divergiriam
 * do valor da linha alterada, sem ninguém perceber.
 *
 * A defesa é a mesma do espelho do ClickUp: uma impressão digital da receita (contagem, soma e última atualização)
 * ANTES e DEPOIS da leitura. Igual → nada mudou no meio, o arquivo é consistente. Diferente → refaz (até 3 vezes) em vez
 * de misturar dois instantes; se não estabilizar, erro explícito e o arquivo NÃO é entregue.
 */

export interface ImpressaoDaReceita {
  linhas: number;
  /** "1234.56" */
  soma: string;
  /** Milissegundos da linha atualizada mais recentemente (null = tabela vazia). */
  atualizadaEm: number | null;
}

export const impressoesIguais = (a: ImpressaoDaReceita, b: ImpressaoDaReceita): boolean => a.linhas === b.linhas && a.soma === b.soma && a.atualizadaEm === b.atualizadaEm;

export async function lerImpressaoDaReceita(): Promise<ImpressaoDaReceita> {
  const r = await prisma.revenueCategorizedLine.aggregate({ _count: { _all: true }, _sum: { valorRecebidoCat: true }, _max: { atualizadoEm: true } });
  return { linhas: r._count._all, soma: (r._sum.valorRecebidoCat ?? 0).toString(), atualizadaEm: r._max.atualizadoEm?.getTime() ?? null };
}

export async function comReceitaEstavel<T>(ler: () => Promise<T>, tentativas = 3): Promise<T> {
  for (let i = 1; i <= tentativas; i++) {
    const antes = await lerImpressaoDaReceita();
    const dados = await ler();
    const depois = await lerImpressaoDaReceita();
    if (impressoesIguais(antes, depois)) return dados;
    await ceder();
  }
  throw new ExportacaoInconsistenteError(
    `A receita mudou ${tentativas} vezes seguidas enquanto os dados eram lidos (uma sincronização estava gravando). O arquivo não foi entregue: tente de novo em alguns instantes.`,
  );
}
