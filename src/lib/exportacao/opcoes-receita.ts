import "server-only";
import { prisma } from "@/lib/db";
import { listCategoriasConhecidas } from "@/lib/categorization/categorias";

/**
 * O que existe de verdade no banco para preencher as listas do formulário de exportação de receita (ADR-0035).
 * Só LEITURA, e só valores distintos — nada de linha.
 */

export interface OpcoesReceita {
  /** "aaaa-mm", do mais recente para o mais antigo. */
  meses: string[];
  /** Todas as categorias conhecidas, mais "Sem Categoria" (é um valor válido para FILTRAR, embora não para atribuir). */
  categorias: string[];
  contas: string[];
  unidades: string[];
  status: string[];
  /** Há linhas sem conta / sem unidade? (então a lista ganha a opção "sem …") */
  temContaVazia: boolean;
  temUnidadeVazia: boolean;
}

export async function opcoesDeReceita(): Promise<OpcoesReceita> {
  const [meses, categorias, contas, unidades, status] = await Promise.all([
    // "0000-00" é o mês sentinela de linha sem data (mes-credito.ts): não é um mês de verdade.
    prisma.revenueCategorizedLine.groupBy({ by: ["mesCredito"], where: { mesCredito: { not: "0000-00" } }, orderBy: { mesCredito: "desc" } }),
    listCategoriasConhecidas(),
    prisma.revenueCategorizedLine.groupBy({ by: ["conta"], orderBy: { conta: "asc" } }),
    prisma.revenueCategorizedLine.groupBy({ by: ["unidade"], orderBy: { unidade: "asc" } }),
    prisma.revenueCategorizedLine.groupBy({ by: ["status"], orderBy: { status: "asc" } }),
  ]);
  const textos = (xs: Array<string | null>) => xs.filter((x): x is string => !!x);
  const cats = new Set([...categorias, "Sem Categoria"]);
  return {
    meses: meses.map((m) => m.mesCredito),
    categorias: [...cats].sort((a, b) => a.localeCompare(b, "pt-BR")),
    contas: textos(contas.map((c) => c.conta)),
    unidades: textos(unidades.map((u) => u.unidade)),
    status: textos(status.map((s) => s.status)),
    temContaVazia: contas.some((c) => !c.conta),
    temUnidadeVazia: unidades.some((u) => !u.unidade),
  };
}
