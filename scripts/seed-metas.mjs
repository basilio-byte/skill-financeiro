/**
 * Cria os escopos de meta (Serviços de Espaço por unidade).
 *
 * Roda AUTOMATICAMENTE a cada boot, pelo docker-entrypoint.sh — e a cada boot
 * mesmo, diferente do seed de categorias, que só semeia quando a tabela está
 * vazia. A diferença é de propósito: a tabela de categorias passa a ser
 * gerenciada por /categorias depois do primeiro boot (reaplicar o CSV
 * sobrescreveria o trabalho da Duda), enquanto os escopos de meta são
 * ESTRUTURA definida no código — rodar sempre faz uma versão nova que
 * acrescente um escopo valer no deploy, sem passo manual.
 *
 * IDEMPOTENTE e não-destrutivo: faz upsert do escopo e das categorias dele,
 * NUNCA apaga escopo nem categoria, e NUNCA encosta em MetaPeriodo — os
 * valores de meta definidos em /metas são dado financeiro e ficam intactos.
 *
 * Atenção para o futuro: o upsert do escopo atualiza `nome`/`ordem`, então se
 * um dia existir tela para renomear escopo, este script passaria por cima no
 * próximo deploy — nessa hora, trocar o `update` por `{}`.
 *
 * As strings de categoria são duplicadas de src/lib/metas/escopos.ts de
 * propósito: este script é .mjs e roda fora do build do Next (sem alias @/),
 * e o teste em escopos.test.ts trava as grafias contra mudança acidental.
 */
import { PrismaClient } from "@prisma/client";

const ESCOPOS = [
  {
    slug: "espaco-seaway",
    nome: "Serviços de Espaço — Seaway Center",
    ordem: 1,
    categorias: ["Serviços de Espaço - Seaway Center"],
  },
  {
    slug: "espaco-sebrae",
    nome: "Serviços de Espaço — Sebrae",
    ordem: 2,
    // DOIS espaços (FIXED_FALLBACKS) + UM espaço (seed de categorias normalizado):
    // as duas grafias da MESMA categoria existem no sistema. Ver escopos.ts.
    categorias: ["Serviços de Espaço -  Sebrae", "Serviços de Espaço - Sebrae"],
  },
  {
    slug: "espaco-ayrton-senna",
    nome: "Serviços de Espaço — Ayrton Senna",
    ordem: 3,
    categorias: ["Serviços de Espaço -  Ayrton Senna", "Serviços de Espaço - Ayrton Senna"],
  },
];

const prisma = new PrismaClient();
try {
  for (const e of ESCOPOS) {
    const escopo = await prisma.metaEscopo.upsert({
      where: { slug: e.slug },
      update: { nome: e.nome, ordem: e.ordem },
      create: { slug: e.slug, nome: e.nome, ordem: e.ordem },
    });
    for (const categoria of e.categorias) {
      await prisma.metaEscopoCategoria.upsert({
        where: { escopoId_categoria: { escopoId: escopo.id, categoria } },
        update: {},
        create: { escopoId: escopo.id, categoria },
      });
    }
    console.log(`[seed-metas] ${e.slug}: ${e.categorias.length} categoria(s) garantida(s).`);
  }
  const total = await prisma.metaEscopo.count();
  console.log(`[seed-metas] pronto — ${total} escopo(s) de meta no banco.`);
} catch (err) {
  console.error("[seed-metas] ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
