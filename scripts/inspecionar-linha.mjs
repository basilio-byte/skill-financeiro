/**
 * Diagnóstico pontual (só leitura): mostra os campos exatos de uma ou mais
 * faturas específicas por crConexaId — dataCredito exato, revisadoManualmente,
 * ultimaRodadaId, atualizadoEm — para investigar por que a limpeza de linha
 * obsoleta não está pegando um caso esperado.
 *
 * Uso: node scripts/inspecionar-linha.mjs 27143 27083 18788
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);

async function main() {
  if (ids.length === 0) {
    console.log("Uso: node scripts/inspecionar-linha.mjs <crConexaId> [outro crConexaId...]");
    return;
  }

  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { crConexaId: { in: ids } },
    include: { ultimaRodada: { select: { id: true, iniciadoEm: true, status: true } } },
  });

  const rodadaAtual = await prisma.revenueSyncRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { iniciadoEm: "desc" },
  });
  const ultimasRodadas = await prisma.revenueSyncRun.findMany({
    orderBy: { iniciadoEm: "desc" },
    take: 3,
    select: { id: true, iniciadoEm: true, concluidoEm: true, status: true, periodoInicio: true, periodoFim: true },
  });

  console.log("Últimas 3 rodadas:");
  for (const r of ultimasRodadas) {
    console.log(
      `  ${r.id} — ${r.status} — período ${r.periodoInicio.toISOString()} a ${r.periodoFim.toISOString()} — iniciada ${r.iniciadoEm.toISOString()}`,
    );
  }
  console.log(`Rodada RUNNING agora: ${rodadaAtual ? rodadaAtual.id : "nenhuma"}`);

  console.log(`\n${linhas.length} linha(s) encontrada(s) para os IDs pedidos:\n`);
  for (const l of linhas) {
    console.log(`CR ${l.crConexaId} — categoria "${l.categoria}" — chaveLinha "${l.chaveLinha}"`);
    console.log(`  id: ${l.id}`);
    console.log(`  dataCredito: ${l.dataCredito ? l.dataCredito.toISOString() : "null"}`);
    console.log(`  valorRecebidoCat: ${l.valorRecebidoCat.toString()}`);
    console.log(`  revisadoManualmente: ${l.revisadoManualmente}`);
    console.log(`  ultimaRodadaId: ${l.ultimaRodadaId} (status: ${l.ultimaRodada?.status}, iniciada: ${l.ultimaRodada?.iniciadoEm?.toISOString()})`);
    console.log(`  atualizadoEm: ${l.atualizadoEm.toISOString()}`);
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("[inspecionar-linha] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
