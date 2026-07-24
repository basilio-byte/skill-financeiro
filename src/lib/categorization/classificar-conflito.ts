import { SEM_CATEGORIA } from "@/lib/categorization/rules";

/**
 * Núcleo PURO da classificação de conflitos (sem I/O) — separado de
 * conflitos.ts (que tem `server-only` e depende de Prisma) para ser
 * testável com Vitest, mesmo padrão já usado em categorize-invoices.ts/
 * dates.ts/auto-sync-window.ts.
 */
export interface LinhaConflito {
  id: string;
  categoria: string;
  chaveLinha: string;
  servicoOuPlano: string;
  valorRecebidoCat: string;
  revisadoManualmente: boolean;
  revisadoPorNome: string | null;
  revisadoEm: string | null;
  categoriaOriginal: string | null;
  valorRecebidoCatOriginal: string | null;
}

export type ClassificacaoConflito =
  | {
      tipo: "duplicata_sem_categoria";
      linhaParaExcluirId: string;
      linhaParaRechavearId: string;
      novaChave: string;
      explicacao: string;
    }
  | { tipo: "manual_superada"; linhaParaExcluirId: string; explicacao: string }
  | { tipo: "ambiguo"; explicacao: string };

/**
 * Classifica um conflito nos dois padrões reais já observados (2026-07-24,
 * as 12 primeiras faturas encontradas), pensados para nunca agir sozinho
 * fora desses dois casos bem definidos:
 *
 * - `duplicata_sem_categoria`: a linha NÃO manual ainda cai em "Sem
 *   Categoria" (o motor nunca vai conseguir categorizar aquele
 *   nome/plano sozinho, ex. "Cliente Avulso"), enquanto a linha manual tem
 *   uma categoria real — só ela carrega informação de verdade. Excluir só a
 *   automática não basta (ela volta na próxima rodada, pois o motor
 *   continua gerando "Sem Categoria" pra aquele nome); a linha manual
 *   também precisa ser "re-chaveada" para a MESMA chave que o motor produz
 *   agora, senão a duplicata reaparece a cada sincronização.
 * - `manual_superada`: as duas linhas já têm a MESMA categoria — uma regra
 *   real passou a existir depois da revisão manual, e o motor agora acerta
 *   sozinho. A linha manual (com a chave antiga, que o motor não gera mais)
 *   é redundante e pode ser excluída com segurança — nunca vai ser recriada.
 * - `ambiguo`: qualquer outro formato (mais de 2 linhas, 2+ manuais,
 *   categorias diferentes e nenhuma é "Sem Categoria", etc.) — precisa de
 *   decisão humana, nunca resolvido sozinho.
 */
export function classificarConflito(linhas: LinhaConflito[]): ClassificacaoConflito {
  const manuais = linhas.filter((l) => l.revisadoManualmente);
  const naoManuais = linhas.filter((l) => !l.revisadoManualmente);

  if (linhas.length !== 2 || manuais.length !== 1 || naoManuais.length !== 1) {
    return {
      tipo: "ambiguo",
      explicacao: "Formato não reconhecido (esperado: exatamente 1 linha manual + 1 automática) — requer decisão humana.",
    };
  }

  const manual = manuais[0]!;
  const naoManual = naoManuais[0]!;

  if (naoManual.categoria === SEM_CATEGORIA && manual.categoria !== SEM_CATEGORIA) {
    return {
      tipo: "duplicata_sem_categoria",
      linhaParaExcluirId: naoManual.id,
      linhaParaRechavearId: manual.id,
      novaChave: naoManual.chaveLinha,
      explicacao: `O motor ainda não sabe categorizar este serviço/plano sozinho (cai em "Sem Categoria" toda rodada) — a linha manual ("${manual.categoria}") é a única fonte de verdade.`,
    };
  }

  if (naoManual.categoria === manual.categoria) {
    return {
      tipo: "manual_superada",
      linhaParaExcluirId: manual.id,
      explicacao: `Uma regra real passou a existir e o motor já categoriza sozinho como "${naoManual.categoria}", igual à revisão manual — a linha manual antiga é redundante.`,
    };
  }

  return {
    tipo: "ambiguo",
    explicacao: `Categorias divergentes ("${manual.categoria}" manual vs "${naoManual.categoria}" automática) — nenhuma é claramente a duplicata.`,
  };
}
