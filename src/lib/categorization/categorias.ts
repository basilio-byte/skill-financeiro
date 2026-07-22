import "server-only";
import { prisma } from "@/lib/db";
import { SEM_CATEGORIA } from "@/lib/categorization/rules";

/**
 * Categorias já em uso no sistema, para oferecer numa lista em vez de exigir
 * digitação livre em todo lugar.
 *
 * Por que existe: os campos de categoria eram texto puro, então cada
 * cadastro podia inventar uma variante do mesmo nome ("Serviços de Espaço"
 * vs "Servicos de Espaco" vs "Serviço de Espaço"). Como os relatórios agrupam
 * por string exata, cada variante virava uma categoria separada no Panorama —
 * receita fatiada em linhas que deveriam ser uma só.
 *
 * Junta as DUAS fontes de verdade, porque nenhuma sozinha é completa:
 *  - a tabela de regras (o que alguém cadastrou explicitamente);
 *  - as linhas já categorizadas (inclui categorias que vêm dos fallbacks
 *    fixos de rules.ts, que não têm regra correspondente na tabela).
 */
export async function listCategoriasConhecidas(): Promise<string[]> {
  const [deRegras, deLinhas] = await Promise.all([
    prisma.revenueCategoryRule.findMany({
      where: { ativo: true },
      select: { categoria: true },
      distinct: ["categoria"],
    }),
    prisma.revenueCategorizedLine.findMany({
      select: { categoria: true },
      distinct: ["categoria"],
    }),
  ]);

  const nomes = new Set<string>();
  for (const r of deRegras) nomes.add(r.categoria);
  for (const l of deLinhas) nomes.add(l.categoria);
  // "Sem Categoria" é o estado de PENDÊNCIA, nunca um destino válido — oferecê-lo
  // na lista deixaria marcar uma linha como não-categorizada de propósito.
  nomes.delete(SEM_CATEGORIA);

  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
