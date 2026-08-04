/**
 * Diagnóstico (só leitura) do alcance de uma regra de categoria aplicada a um
 * nome de serviço/plano genérico (ex. "Cliente Avulso") — usado em
 * 2026-08-04 pra investigar os conflitos "ambíguos" 15476/15734 na Fase 3 da
 * ADR-0029: uma revisão manual e a regra automática discordam de categoria
 * pro MESMO nome de plano, o que só é visível hoje quando o Conexa também
 * gerou uma linha manual pra comparar (nas demais faturas com o mesmo nome,
 * sem revisão manual, a regra aplica silenciosamente e não aparece em
 * /conflitos).
 *
 * Uso: node scripts/diagnostico-cliente-avulso.mjs "Cliente Avulso"
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const termo = process.argv[2];
if (!termo) {
  console.error('Uso: node scripts/diagnostico-cliente-avulso.mjs "<texto do servicoOuPlano>"');
  process.exit(1);
}

async function main() {
  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { servicoOuPlano: { contains: termo, mode: "insensitive" } },
    select: {
      crConexaId: true,
      razaoSocial: true,
      categoria: true,
      chaveLinha: true,
      mesCredito: true,
      valorRecebidoCat: true,
      revisadoManualmente: true,
      servicoOuPlano: true,
    },
    orderBy: [{ crConexaId: "asc" }],
  });

  console.log(`Total de linhas com servicoOuPlano contendo "${termo}": ${linhas.length}\n`);

  const porCategoria = new Map();
  for (const l of linhas) {
    const chave = l.categoria;
    if (!porCategoria.has(chave)) porCategoria.set(chave, { linhas: 0, faturas: new Set(), soma: 0 });
    const c = porCategoria.get(chave);
    c.linhas += 1;
    c.faturas.add(l.crConexaId);
    c.soma += Number(l.valorRecebidoCat.toString());
  }

  console.log("Por categoria:");
  for (const [categoria, c] of porCategoria) {
    console.log(
      `  ${categoria}: ${c.linhas} linha(s), ${c.faturas.size} fatura(s) distinta(s), soma R$ ${c.soma.toFixed(2)}`,
    );
  }

  const clientesDistintos = new Set(linhas.map((l) => l.razaoSocial));
  console.log(`\nClientes (razaoSocial) distintos usando este plano: ${clientesDistintos.size}`);
  if (clientesDistintos.size > 1) {
    console.log(
      "  Mais de um cliente usa este nome de plano — uma regra que mapeia por nome sozinha " +
        "pode estar acertando um cliente e errando outro (mesmo risco documentado na ADR-0020).",
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
