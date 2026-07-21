/**
 * Semeia RevenueCategoryRule a partir da tabela de categorização mantida pela
 * Duda (`prisma/seeds/categorizacao-inicial.csv`, exportada da planilha
 * Categorizacao.xlsx).
 *
 * Roda automaticamente no boot (docker-entrypoint.sh), então precisa ser
 * SEGURO rodar em todo restart do container: só semeia se a tabela estiver
 * VAZIA (primeiro boot). Depois disso, a tabela é gerenciada pela tela
 * /categorias — reaplicar o CSV a cada restart sobrescreveria silenciosamente
 * qualquer correção manual que o financeiro tenha feito para um nome que já
 * existia no CSV original. Script plano em JS (sem TypeScript/tsx) para
 * poder rodar tanto em dev quanto na imagem de produção sem dependências
 * extras — mesmo espírito do scripts/bootstrap-admin.mjs.
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

function normalize(s) {
  return s.trim().replace(/\s+/g, " ");
}

async function main() {
  const existing = await prisma.revenueCategoryRule.count();
  if (existing > 0) {
    console.log(
      `[seed-categories] tabela já tem ${existing} regra(s) — pulando (gerenciada por /categorias a partir daqui).`,
    );
    return;
  }

  const csvPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "prisma",
    "seeds",
    "categorizacao-inicial.csv",
  );
  const lines = readFileSync(csvPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const [, ...rows] = lines; // descarta cabeçalho "Nome,Categoria do Serviço"

  const seen = new Map();
  for (const line of rows) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const nome = normalize(line.slice(0, idx));
    const categoria = normalize(line.slice(idx + 1));
    if (!nome || !categoria) continue;
    seen.set(nome, categoria); // duplicatas exatas: a última linha vence
  }

  await prisma.revenueCategoryRule.createMany({
    data: [...seen.entries()].map(([nome, categoria]) => ({ nome, categoria })),
  });

  console.log(`[seed-categories] ${seen.size} regras criadas a partir do CSV inicial.`);
}

main()
  .catch((err) => {
    console.error("[seed-categories] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
