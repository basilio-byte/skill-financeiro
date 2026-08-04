/**
 * SNAPSHOT DO ESTADO ANTES — somente leitura, não altera absolutamente nada.
 *
 * Existe por pedido explícito do usuário (2026-08-04): antes de mexer na chave
 * de identidade de `RevenueCategorizedLine` (ADR-0029), registrar o estado atual
 * de forma completa o bastante para (a) comparar depois e (b) reverter.
 *
 * Este script NÃO substitui o backup. Ele produz os NÚMEROS de conferência; o
 * backup da tabela é o `pg_dump` descrito na ADR-0029. Um sem o outro não serve:
 * o dump restaura os dados, os números provam se a restauração ficou correta.
 *
 * Rodar no Console do serviço da APLICAÇÃO no Easypanel (tem node + DATABASE_URL):
 *     node scripts/snapshot-antes.mjs > /tmp/snapshot-antes.txt
 *     cat /tmp/snapshot-antes.txt
 *
 * A saída é texto puro, pensada para ser copiada inteira e commitada em
 * docs/context/snapshot-antes-2026-08-04.md.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const linha = (c = "=") => console.log(c.repeat(78));

try {
  console.log("SNAPSHOT DO ESTADO ANTES — revenue_categorized_lines");
  console.log(`Gerado em: ${new Date().toISOString()}`);
  console.log("Script: scripts/snapshot-antes.mjs (somente leitura)");
  linha();

  // ---------------------------------------------------------------- totais
  const [tot] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS linhas,
           count(DISTINCT "crConexaId")::int AS faturas,
           coalesce(sum("valorRecebidoCat"), 0)::text AS total,
           count(*) FILTER (WHERE "dataCredito" IS NULL)::int AS sem_data,
           count(*) FILTER (WHERE "revisadoManualmente")::int AS revisadas
    FROM revenue_categorized_lines`);
  console.log("\n## 1. Totais gerais");
  console.log(`   linhas ................. ${tot.linhas}`);
  console.log(`   faturas distintas ...... ${tot.faturas}`);
  console.log(`   soma valorRecebidoCat .. ${brl(tot.total)}   (bruto: ${tot.total})`);
  console.log(`   linhas SEM dataCredito . ${tot.sem_data}   <- relevante: NULL não colide em índice único`);
  console.log(`   revisadas manualmente .. ${tot.revisadas}   <- estas nunca podem ser perdidas`);

  // ------------------------------------------------------------ por mês
  const porMes = await prisma.$queryRawUnsafe(`
    SELECT to_char("dataCredito", 'YYYY-MM') AS mes,
           count(*)::int AS linhas,
           count(DISTINCT "crConexaId")::int AS faturas,
           sum("valorRecebidoCat")::text AS total
    FROM revenue_categorized_lines
    WHERE "dataCredito" IS NOT NULL
    GROUP BY 1 ORDER BY 1`);
  console.log("\n## 2. Por mês de dataCredito  <<< A CONFERÊNCIA PRINCIPAL DO ANTES/DEPOIS");
  console.log("   mês      | linhas | faturas | total");
  for (const m of porMes) {
    console.log(`   ${m.mes}  | ${String(m.linhas).padStart(6)} | ${String(m.faturas).padStart(7)} | ${brl(m.total).padStart(16)}`);
  }

  // ------------------------------------------------- por mês x categoria
  const porCat = await prisma.$queryRawUnsafe(`
    SELECT to_char("dataCredito", 'YYYY-MM') AS mes, categoria,
           count(*)::int AS linhas, sum("valorRecebidoCat")::text AS total
    FROM revenue_categorized_lines
    WHERE "dataCredito" IS NOT NULL
    GROUP BY 1, 2 ORDER BY 1, 4 DESC`);
  console.log("\n## 3. Por mês x categoria");
  for (const c of porCat) {
    console.log(`   ${c.mes} | ${String(c.linhas).padStart(5)} | ${brl(c.total).padStart(15)} | ${c.categoria}`);
  }

  // ------------------------------------ faturas com mais de uma linha/mês
  // Se a correção estiver certa, este número só pode CRESCER (uma fatura
  // recorrente passa a ter uma linha por mês). Nenhuma linha existente some.
  const [multi] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS faturas_em_varios_meses FROM (
      SELECT "crConexaId"
      FROM revenue_categorized_lines
      WHERE "dataCredito" IS NOT NULL
      GROUP BY "crConexaId"
      HAVING count(DISTINCT to_char("dataCredito", 'YYYY-MM')) > 1
    ) x`);
  console.log("\n## 4. Faturas que HOJE aparecem em mais de um mês");
  console.log(`   ${multi.faturas_em_varios_meses}   <- hoje deve ser ~0 (a linha é sobrescrita); depois da correção, cresce`);

  // ------------------------------------------- colisões sob a chave nova
  // Prova de que a migration da chave nova NÃO vai falhar por duplicidade.
  const colisoes = await prisma.$queryRawUnsafe(`
    SELECT "crConexaId", "chaveLinha", to_char("dataCredito", 'YYYY-MM') AS mes, count(*)::int AS n
    FROM revenue_categorized_lines
    WHERE "dataCredito" IS NOT NULL
    GROUP BY 1, 2, 3 HAVING count(*) > 1
    ORDER BY 4 DESC LIMIT 20`);
  console.log("\n## 5. Colisões sob a chave NOVA (crConexaId, chaveLinha, mês)");
  if (colisoes.length === 0) {
    console.log("   NENHUMA — a migration do índice único pode ser aplicada com segurança.");
  } else {
    console.log(`   ATENÇÃO: ${colisoes.length} grupo(s) colidem. A migration FALHARIA. Resolver antes:`);
    for (const c of colisoes) console.log(`   CR ${c.crConexaId} | ${c.mes} | n=${c.n} | ${c.chaveLinha}`);
  }

  // ------------------------------------------ inventário das recorrentes
  // O grupo de risco: são exatamente estas que migram de mês hoje.
  const recorrentes = await prisma.$queryRawUnsafe(`
    SELECT "crConexaId", to_char("dataCredito", 'YYYY-MM-DD') AS data,
           "valorRecebidoCat"::text AS valor, categoria, "revisadoManualmente"
    FROM revenue_categorized_lines
    WHERE "dataCredito" IS NOT NULL
    ORDER BY "crConexaId", categoria`);
  console.log(`\n## 6. Inventário COMPLETO das linhas (${recorrentes.length}) — para diff exato depois`);
  console.log("   crConexaId;dataCredito;valorRecebidoCat;categoria;revisadoManualmente");
  for (const r of recorrentes) {
    console.log(`   ${r.crConexaId};${r.data};${r.valor};${r.categoria};${r.revisadoManualmente ? "S" : "N"}`);
  }

  linha();
  console.log("FIM DO SNAPSHOT — copiar TUDO acima para docs/context/snapshot-antes-2026-08-04.md");
} catch (err) {
  console.error("[snapshot-antes] ERRO:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
