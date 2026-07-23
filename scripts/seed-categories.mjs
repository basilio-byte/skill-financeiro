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
 * internas (confirmado inspecionando o arquivo real).
 *
 * Normalização = SÓ trim (ADR-0018, porta exata de categoriza_receita.py):
 * `load_categorias()` do script real faz `str(nome).strip()`/`str(cat).strip()`
 * — NUNCA colapsa espaço interno duplo. Uma versão anterior deste script
 * colapsava espaços duplos nas duas colunas, o que parecia "corrigir" uma
 * inconsistência de digitação, mas na verdade GRAVAVA UMA STRING DIFERENTE da
 * que a Duda validou: a tabela real tem, de forma 100% consistente (não é
 * ruído), espaço duplo em "Serviços de Espaço -  Sebrae"/"-  Ayrton Senna" e
 * "Salas Privativas -  Sebrae"/"-  Ayrton Senna" — o script Python preserva
 * esse espaço duplo exatamente, e o fallback fixo em rules.ts também usa essa
 * mesma grafia. Colapsar aqui produzia uma SEGUNDA grafia (espaço único) para
 * a mesma categoria real, fatiando a receita dessas duas unidades em duas
 * strings de categoria diferentes no Panorama.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalize(s) {
  return s.trim();
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
