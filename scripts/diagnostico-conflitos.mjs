/**
 * Diagnóstico (SÓ LEITURA, não corrige nada) das faturas com "possível dupla
 * contagem" sinalizadas por persist.ts (totalFaturasComConflito).
 *
 * O que causa isso (ADR-0013): uma linha revisada manualmente (categoria/
 * valor corrigidos à mão via /revisar) fica PRESERVADA para sempre, mesmo
 * quando a sincronização automática deixa de produzir aquele bucket (ex.:
 * a categoria "adivinhada" à mão ganhou depois uma RevenueCategoryRule de
 * verdade, e a próxima rodada passa a gerar um bucket NOVO, com chaveLinha
 * diferente, para a mesma fatura). As duas linhas somadas passam a valer
 * mais que o total real da fatura — dinheiro contado duas vezes.
 *
 * Este script lista, para cada fatura (crConexaId) cuja soma das linhas
 * ATUAIS diverge do valor total dela, TODAS as linhas envolvidas — a
 * revisada manualmente (com o que ela dizia ANTES da revisão, em
 * categoriaOriginal/valorRecebidoCatOriginal) e a(s) nova(s) — para um
 * humano decidir qual versão é a certa. NÃO decide sozinho e NÃO apaga
 * nada — só imprime o que precisa de decisão.
 *
 * Rodar em produção via Console do Easypanel: node scripts/diagnostico-conflitos.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TOLERANCIA = 0.02;

function n(decimal) {
  return Number(decimal.toString());
}

async function main() {
  const linhas = await prisma.revenueCategorizedLine.findMany({
    orderBy: [{ crConexaId: "asc" }, { chaveLinha: "asc" }],
    include: { revisadoPor: { select: { name: true, email: true } } },
  });

  const porFatura = new Map();
  for (const l of linhas) {
    if (!porFatura.has(l.crConexaId)) porFatura.set(l.crConexaId, []);
    porFatura.get(l.crConexaId).push(l);
  }

  let totalConflitos = 0;
  let excessoTotal = 0;

  for (const [crConexaId, ls] of porFatura.entries()) {
    const valorTotal = n(ls[0].valorRecebidoTotal);
    const somaAtual = ls.reduce((acc, l) => acc + n(l.valorRecebidoCat), 0);
    const diff = somaAtual - valorTotal;
    if (Math.abs(diff) <= TOLERANCIA) continue;

    totalConflitos++;
    excessoTotal += diff;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`Fatura CR ID ${crConexaId} — ${ls[0].razaoSocial ?? "(sem nome)"}`);
    console.log(`  Valor Recebido Total (da fatura, no Conexa): R$ ${valorTotal.toFixed(2)}`);
    console.log(`  Soma das linhas ATUAIS no nosso banco:       R$ ${somaAtual.toFixed(2)}`);
    console.log(`  Diferença (excesso se positivo):             R$ ${diff.toFixed(2)}`);
    console.log(`  Linhas:`);
    for (const l of ls) {
      console.log(
        `    - categoria="${l.categoria}" valor=R$${n(l.valorRecebidoCat).toFixed(2)} ` +
          `chaveLinha="${l.chaveLinha}" servico/plano="${l.servicoOuPlano}"`,
      );
      if (l.revisadoManualmente) {
        console.log(
          `      ^ REVISADA MANUALMENTE por ${l.revisadoPor?.name ?? l.revisadoPor?.email ?? "?"} em ${l.revisadoEm?.toISOString().slice(0, 16) ?? "?"}`,
        );
        console.log(
          `        antes da revisão, a skill tinha calculado: categoria="${l.categoriaOriginal ?? "?"}" ` +
            `valor=R$${l.valorRecebidoCatOriginal ? n(l.valorRecebidoCatOriginal).toFixed(2) : "?"}`,
        );
      }
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    `\n${totalConflitos} fatura(s) com possível dupla contagem. Excesso total somado nas categorias: R$ ${excessoTotal.toFixed(2)}.`,
  );
  console.log(
    "Nenhuma alteração foi feita — este script só lê. Para cada fatura acima, decida qual linha é a " +
      "correta e ajuste manualmente (via /revisar, ou apagando a linha errada direto no banco) — nunca " +
      "às cegas, já que só um humano sabe qual categoria realmente vale para aquele caso.",
  );
}

main()
  .catch((err) => {
    console.error("[diagnostico-conflitos] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
