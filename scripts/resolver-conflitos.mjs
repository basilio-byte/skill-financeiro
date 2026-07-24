/**
 * Resolve automaticamente as faturas com "possível dupla contagem" que se
 * encaixam nos dois padrões seguros já confirmados (2026-07-24) — mesma
 * lógica de src/lib/categorization/conflitos.ts (classificarConflito),
 * duplicada aqui em JS puro porque scripts standalone não passam pelo
 * bundler/alias do Next (mesmo motivo de fix-categorias-espacamento.mjs).
 * Qualquer mudança na regra de classificação precisa ser replicada nos dois
 * lugares — se um dia divergirem, esta cópia é que está desatualizada.
 *
 * Os dois padrões resolvidos sozinhos:
 *   - "duplicata_sem_categoria": a linha automática ainda cai em "Sem
 *     Categoria" (o motor nunca vai conseguir categorizar aquele nome/plano
 *     sozinho, ex. "Cliente Avulso"), a manual tem categoria real. Apaga a
 *     automática e RE-CHAVEIA a manual pra chave dela — sem isso, a
 *     duplicata reaparece na sincronização seguinte.
 *   - "manual_superada": as duas linhas já têm a MESMA categoria (uma regra
 *     real passou a existir depois da revisão manual). Apaga só a manual
 *     (chave antiga, nunca mais recriada).
 *
 * Qualquer outro formato (mais de 2 linhas, 2+ manuais, categorias
 * divergentes e nenhuma "Sem Categoria") fica de fora — reportado, nunca
 * resolvido às cegas.
 *
 * IDEMPOTENTE: rodar de novo depois de já ter corrigido tudo não acha mais
 * nada pra fazer (a diferença já fecha).
 *
 * Rodar em produção via Console do Easypanel: node scripts/resolver-conflitos.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TOLERANCIA = 0.02;
const SEM_CATEGORIA = "Sem Categoria";

function n(decimal) {
  return Number(decimal.toString());
}

function classificar(linhas) {
  const manuais = linhas.filter((l) => l.revisadoManualmente);
  const naoManuais = linhas.filter((l) => !l.revisadoManualmente);
  if (linhas.length !== 2 || manuais.length !== 1 || naoManuais.length !== 1) {
    return { tipo: "ambiguo" };
  }
  const manual = manuais[0];
  const naoManual = naoManuais[0];

  if (naoManual.categoria === SEM_CATEGORIA && manual.categoria !== SEM_CATEGORIA) {
    return { tipo: "duplicata_sem_categoria", excluir: naoManual, rechavear: manual, novaChave: naoManual.chaveLinha };
  }
  if (naoManual.categoria === manual.categoria) {
    return { tipo: "manual_superada", excluir: manual };
  }
  return { tipo: "ambiguo" };
}

async function main() {
  const linhas = await prisma.revenueCategorizedLine.findMany({
    orderBy: [{ crConexaId: "asc" }, { chaveLinha: "asc" }],
  });

  const porFatura = new Map();
  for (const l of linhas) {
    if (!porFatura.has(l.crConexaId)) porFatura.set(l.crConexaId, []);
    porFatura.get(l.crConexaId).push(l);
  }

  let resolvidas = 0;
  let ambiguas = 0;

  for (const [crConexaId, ls] of porFatura.entries()) {
    const valorTotal = n(ls[0].valorRecebidoTotal);
    const soma = ls.reduce((acc, l) => acc + n(l.valorRecebidoCat), 0);
    if (Math.abs(soma - valorTotal) <= TOLERANCIA) continue;

    const classificacao = classificar(ls);

    if (classificacao.tipo === "ambiguo") {
      console.log(
        `[resolver-conflitos] AMBÍGUO, requer decisão humana: fatura CR ${crConexaId} — ` +
          `${ls.length} linha(s), valor real R$${valorTotal.toFixed(2)}, soma atual R$${soma.toFixed(2)}. ` +
          `Veja /conflitos ou rode diagnostico-conflitos.mjs para o detalhe.`,
      );
      ambiguas++;
      continue;
    }

    await prisma.$transaction(
      async (tx) => {
        if (classificacao.tipo === "manual_superada") {
          await tx.revenueCategorizedLine.delete({ where: { id: classificacao.excluir.id } });
          return;
        }
        // duplicata_sem_categoria: exclui a automática ANTES de re-chavear a
        // manual — na ordem inversa, o @@unique([crConexaId, chaveLinha])
        // rejeitaria o update.
        await tx.revenueCategorizedLine.delete({ where: { id: classificacao.excluir.id } });
        await tx.revenueCategorizedLine.update({
          where: { id: classificacao.rechavear.id },
          data: { chaveLinha: classificacao.novaChave },
        });
      },
      { isolationLevel: "Serializable" },
    );

    console.log(
      `[resolver-conflitos] resolvida (${classificacao.tipo}): fatura CR ${crConexaId} — ` +
        `excesso de R$${(soma - valorTotal).toFixed(2)} corrigido.`,
    );
    resolvidas++;
  }

  console.log(`\n[resolver-conflitos] ${resolvidas} fatura(s) resolvida(s), ${ambiguas} ainda precisam de decisão humana.`);
}

main()
  .catch((err) => {
    console.error("[resolver-conflitos] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
