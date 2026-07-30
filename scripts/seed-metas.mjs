/**
 * Cria os escopos de meta: Endereço Fiscal, Meu Depósito, Salas Privativas,
 * SeaBox e Serviços de Espaço (este último somando as 3 unidades).
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
 * Até 2026-07-24 existiam 3 escopos (um por unidade) — unificados num só a
 * pedido da Duda (ver migration 20260725000000_metas_trimestrais, que remove
 * os 3 antigos do banco; este script recria só o novo).
 *
 * As strings de categoria são duplicadas de src/lib/metas/escopos.ts de
 * propósito: este script é .mjs e roda fora do build do Next (sem alias @/),
 * e o teste em escopos.test.ts trava as grafias contra mudança acidental.
 */
import { PrismaClient } from "@prisma/client";

// ORDEM ALFABÉTICA pelo nome (pedido do usuário 2026-07-28) — `ordem` é o campo
// que ordena o Panorama e /metas. Espelha src/lib/metas/escopos.ts: qualquer
// mudança aqui precisa ser feita lá também (e escopos.test.ts trava as grafias).
const ESCOPOS = [
  { slug: "endereco-fiscal", nome: "Endereço Fiscal", ordem: 1, categorias: ["Endereço Fiscal"] },
  { slug: "meu-deposito", nome: "Meu Depósito", ordem: 2, categorias: ["Meu Depósito"] },
  {
    slug: "salas-privativas",
    nome: "Salas Privativas",
    ordem: 3,
    // Mesmo split de grafia de "Serviços de Espaço": DOIS espaços em
    // Sebrae/Ayrton Senna (o que está gravado), UM espaço como defesa.
    categorias: [
      "Salas Privativas - Seaway Center",
      "Salas Privativas -  Sebrae",
      "Salas Privativas - Sebrae",
      "Salas Privativas -  Ayrton Senna",
      "Salas Privativas - Ayrton Senna",
    ],
  },
  { slug: "seabox", nome: "SeaBox", ordem: 4, categorias: ["SeaBox"] },
  // "Total recebido" (ordem 6, abaixo): soma TUDO via flag `todasCategorias`,
  // sem listar categoria — pedido da Duda. Ver escopos.ts.
  {
    slug: "servicos-de-espaco",
    nome: "Serviços de Espaço",
    ordem: 5,
    // DOIS espaços (FIXED_FALLBACKS) + UM espaço (seed de categorias normalizado)
    // para Sebrae/Ayrton Senna: as duas grafias da MESMA categoria existem no
    // sistema. Seaway Center não tem esse split. Ver escopos.ts.
    categorias: [
      "Serviços de Espaço - Seaway Center",
      "Serviços de Espaço -  Sebrae",
      "Serviços de Espaço - Sebrae",
      "Serviços de Espaço -  Ayrton Senna",
      "Serviços de Espaço - Ayrton Senna",
    ],
  },
  { slug: "total-recebido", nome: "Total recebido", ordem: 6, categorias: [], todasCategorias: true },
];

const prisma = new PrismaClient();
try {
  for (const e of ESCOPOS) {
    const todasCategorias = e.todasCategorias === true;
    const escopo = await prisma.metaEscopo.upsert({
      where: { slug: e.slug },
      update: { nome: e.nome, ordem: e.ordem, todasCategorias },
      create: { slug: e.slug, nome: e.nome, ordem: e.ordem, todasCategorias },
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
