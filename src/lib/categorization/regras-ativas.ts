import { prisma } from "@/lib/db";
import type { CategoryRule } from "@/lib/categorization/rules";

/**
 * As regras de categorização que uma rodada usa — a MESMA consulta na rodada real e
 * na prévia da importação manual, para a prévia nunca categorizar diferente.
 *
 * orderBy explícito: o desempate de "maior prefixo" (rules.ts) precisa da MESMA ordem
 * de chegada que o script real tem (ordem das linhas na planilha de categorias) para
 * empates de mesmo comprimento resolverem igual. `id` (cuid) é aproximadamente
 * cronológico — não é uma garantia formal de ordem-de-arquivo, mas é o melhor proxy
 * disponível sem migrar o schema para uma coluna de ordem explícita (ver ADR-0018).
 */
export async function regrasAtivasParaRodada(): Promise<CategoryRule[]> {
  const rules = await prisma.revenueCategoryRule.findMany({
    where: { ativo: true },
    orderBy: { id: "asc" },
  });
  return rules.map((r) => ({ nome: r.nome, categoria: r.categoria }));
}
