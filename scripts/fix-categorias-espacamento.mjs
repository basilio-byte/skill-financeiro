/**
 * Corrige RevenueCategoryRule.nome/categoria para linhas que a versão antiga
 * (com bug) de seed-categories.mjs colapsou espaço interno duplo, divergindo
 * do valor real da planilha da Duda e do que categoriza_receita.py produz
 * (ADR-0018). Ver docs/context/decisions.md para o achado completo.
 *
 * IDEMPOTENTE — seguro rodar mais de uma vez (inclusive em produção, uma
 * única vez após o deploy desta correção): só corrige uma linha se o valor
 * ATUAL bate EXATAMENTE com o que o bug de colapso produziria a partir do CSV
 * — sinal preciso de "nunca foi editada manualmente, ainda tem o valor
 * mecanicamente semeado errado". Qualquer linha cujo valor atual seja
 * QUALQUER outra coisa (inclusive já corrigida, ou uma correção manual real
 * feita via /categorias) fica intocada e é reportada em "sem ação" para
 * revisão humana, nunca sobrescrita às cegas.
 *
 * Script standalone, não roda automaticamente no boot (diferente do
 * seed-categories.mjs) — é uma correção pontual de dado já persistido, não
 * algo que deva rodar em todo restart do container.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function collapse(s) {
  return s.replace(/\s+/g, " ");
}

async function main() {
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
  const [, ...rows] = lines;

  const seen = new Map();
  for (const line of rows) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const nome = line.slice(0, idx).trim();
    const categoria = line.slice(idx + 1).trim();
    if (!nome || !categoria) continue;
    seen.set(nome, categoria); // duplicatas exatas: a última linha do CSV vence
  }

  let corrigidas = 0;
  let semAcao = 0;
  let jaCorretas = 0;

  for (const [nomeCorreto, categoriaCorreta] of seen.entries()) {
    const nomeColapsado = collapse(nomeCorreto);
    const categoriaColapsada = collapse(categoriaCorreta);
    const afetada = nomeColapsado !== nomeCorreto || categoriaColapsada !== categoriaCorreta;
    if (!afetada) continue; // esta linha nunca teve espaço duplo, nunca foi afetada pelo bug

    // Caso A: o Nome nunca teve o problema (só a Categoria foi colapsada no seed).
    let existente = await prisma.revenueCategoryRule.findUnique({ where: { nome: nomeCorreto } });
    if (existente) {
      if (existente.categoria === categoriaCorreta) {
        jaCorretas++;
        continue;
      }
      if (existente.categoria !== categoriaColapsada) {
        console.log(
          `[fix-categorias-espacamento] SEM AÇÃO (categoria atual não é a esperada nem a colapsada — provável edição manual): nome="${nomeCorreto}" categoria atual="${existente.categoria}"`,
        );
        semAcao++;
        continue;
      }
      await prisma.revenueCategoryRule.update({ where: { id: existente.id }, data: { categoria: categoriaCorreta } });
      console.log(`[fix-categorias-espacamento] corrigida categoria de "${nomeCorreto}": "${categoriaColapsada}" -> "${categoriaCorreta}"`);
      corrigidas++;
      continue;
    }

    // Caso B: o Nome também foi colapsado no seed original.
    existente = await prisma.revenueCategoryRule.findUnique({ where: { nome: nomeColapsado } });
    if (!existente) {
      semAcao++;
      continue;
    }
    if (existente.categoria !== categoriaColapsada) {
      console.log(
        `[fix-categorias-espacamento] SEM AÇÃO (categoria atual não é a esperada nem a colapsada — provável edição manual): nome="${nomeColapsado}" categoria atual="${existente.categoria}"`,
      );
      semAcao++;
      continue;
    }
    await prisma.revenueCategoryRule.update({
      where: { id: existente.id },
      data: { nome: nomeCorreto, categoria: categoriaCorreta },
    });
    console.log(
      `[fix-categorias-espacamento] corrigida linha: nome "${nomeColapsado}" -> "${nomeCorreto}", categoria "${categoriaColapsada}" -> "${categoriaCorreta}"`,
    );
    corrigidas++;
  }

  console.log(
    `\n[fix-categorias-espacamento] ${corrigidas} regra(s) corrigida(s), ${jaCorretas} já corretas, ${semAcao} sem ação (não encontrada ou possível edição manual).`,
  );
}

main()
  .catch((err) => {
    console.error("[fix-categorias-espacamento] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
