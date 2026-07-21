/**
 * Semeia RevenueCategoryRule a partir da tabela de categorização mantida pela
 * Duda (`prisma/seeds/categorizacao-inicial.csv`, exportada da planilha
 * Categorizacao.xlsx). Idempotente (upsert por nome normalizado) — pode ser
 * rodado de novo com segurança se a planilha for atualizada.
 *
 * Formato do CSV: 2 colunas, `Nome,Categoria do Serviço`, sem aspas/vírgulas
 * internas (confirmado inspecionando o arquivo real). Normaliza espaços
 * (trim + colapsa espaços duplos) — o arquivo original tem várias
 * inconsistências desse tipo (ex.: "Endereço Fiscal " com espaço à direita).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

async function main() {
  const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "seeds", "categorizacao-inicial.csv");
  const lines = readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [, ...rows] = lines; // descarta cabeçalho "Nome,Categoria do Serviço"

  const seen = new Map<string, string>();
  for (const line of rows) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const nome = normalize(line.slice(0, idx));
    const categoria = normalize(line.slice(idx + 1));
    if (!nome || !categoria) continue;
    seen.set(nome, categoria); // duplicatas exatas: a última linha vence
  }

  let created = 0;
  let updated = 0;
  for (const [nome, categoria] of seen) {
    const result = await prisma.revenueCategoryRule.upsert({
      where: { nome },
      update: { categoria, ativo: true },
      create: { nome, categoria },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created += 1;
    else updated += 1;
  }

  console.log(`[seed-categories] ${seen.size} regras processadas (${created} novas, ${updated} atualizadas).`);
}

main()
  .catch((err) => {
    console.error("[seed-categories] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
