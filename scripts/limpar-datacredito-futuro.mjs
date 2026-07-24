/**
 * Limpa linhas persistidas com `dataCredito` no FUTURO (além de hoje de
 * verdade) — o mesmo artefato encontrado em 2026-07-24: uma sincronização
 * MANUAL pediu período até 31/07 quando "hoje" ainda era 23/07, e a regra de
 * aceitação "qualquer data da lista de Data Crédito que caia no período"
 * (fidelidade ao Python, ADR-0018/0019) aceitou datas agendadas pro futuro
 * (ainda não realizadas) como se já fossem dinheiro recebido.
 *
 * "Data Crédito" só faz sentido no passado/presente — nenhuma linha deveria
 * ter essa data além de hoje. `run.ts` já foi corrigido para nunca mais
 * ACEITAR uma data futura (não importa o período pedido); este script limpa
 * o que já ficou persistido ANTES dessa correção existir.
 *
 * Conservador, igual aos outros scripts de correção deste projeto: só apaga
 * se `revisadoManualmente = false` (nunca é o caso aqui, dado o mecanismo,
 * mas checado mesmo assim). Se uma linha com dataCredito futuro estiver
 * revisada manualmente, é reportada e NADA é feito — precisa de decisão
 * humana (não deveria acontecer no fluxo normal: revisão manual só corrige
 * categoria/valor, nunca dataCredito).
 *
 * Quando essas faturas realmente forem creditadas (o dia chegar), a
 * sincronização automática vai recriá-las corretamente na data certa, com o
 * valor certo — apagar agora não perde nada de real, só remove o que foi
 * contado cedo demais.
 *
 * Rodar em produção via Console do Easypanel: node scripts/limpar-datacredito-futuro.mjs
 * Idempotente — rodar de novo depois de já ter limpado não acha mais nada.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hojeUTC() {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

async function main() {
  const hoje = hojeUTC();
  console.log(`Hoje (UTC, data-calendário): ${hoje.toISOString().slice(0, 10)}`);

  const linhasFuturas = await prisma.revenueCategorizedLine.findMany({
    where: { dataCredito: { gt: hoje } },
    orderBy: { dataCredito: "asc" },
  });

  if (linhasFuturas.length === 0) {
    console.log("Nenhuma linha com Data Crédito no futuro — nada para limpar.");
    return;
  }

  console.log(`\n${linhasFuturas.length} linha(s) com Data Crédito no futuro encontrada(s):\n`);

  const idsParaApagar = [];
  let totalApagado = 0;
  let totalPreservado = 0;

  for (const l of linhasFuturas) {
    const valor = Number(l.valorRecebidoCat.toString());
    console.log(
      `  CR ${l.crConexaId} — "${l.categoria}" — R$${valor.toFixed(2)} — dataCredito ${l.dataCredito.toISOString().slice(0, 10)} — ` +
        `revisadoManualmente: ${l.revisadoManualmente}`,
    );
    if (l.revisadoManualmente) {
      console.log(`    ⚠️  REVISADA MANUALMENTE — não apagando, requer decisão humana.`);
      totalPreservado++;
      continue;
    }
    idsParaApagar.push(l.id);
    totalApagado += valor;
  }

  if (idsParaApagar.length > 0) {
    await prisma.revenueCategorizedLine.deleteMany({ where: { id: { in: idsParaApagar } } });
  }

  console.log(
    `\n${idsParaApagar.length} linha(s) apagada(s) (R$${totalApagado.toFixed(2)}), ${totalPreservado} preservada(s) (revisada manualmente, requer revisão humana).`,
  );
  console.log("Quando a data real chegar, a sincronização automática recria essas faturas corretamente, se ainda válidas.");
}

main()
  .catch((err) => {
    console.error("[limpar-datacredito-futuro] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
