-- Metas passam de mensal para trimestral (alinhado com a Duda, 2026-07-24), e
-- os 3 escopos por unidade ("Serviços de Espaço — Seaway/Sebrae/Ayrton Senna")
-- viram UM escopo único ("Serviços de Espaço") somando as 3 unidades.
--
-- Nenhuma meta real foi definida até agora (confirmado: 0 MetaPeriodo em
-- produção) — por isso apagar aqui é seguro. Mesmo assim, o DELETE é
-- explícito (não um TRUNCATE silencioso) e vem ANTES de qualquer constraint
-- nova, porque um "yyyy-MM" antigo nunca bateria com o formato "yyyy-Q#" e a
-- ADD CONSTRAINT abaixo falharia (validação contra linhas existentes) se
-- alguma linha realmente existisse — preferível a silenciosamente truncar o
-- formato errado.
DELETE FROM "meta_periodos";

-- Remove os 3 escopos antigos por unidade. Seguro por construção: a FK
-- meta_periodos_escopoId_fkey é ON DELETE RESTRICT, então se alguma meta
-- real ainda referenciasse um desses escopos (não deveria, dado o DELETE
-- acima já ter limpado a tabela), este DELETE falharia alto em vez de
-- perder dado em silêncio. meta_escopo_categorias cai junto (CASCADE).
-- O escopo novo ("servicos-de-espaco") é recriado pelo seed-metas.mjs no
-- próximo boot — não precisa ser inserido aqui.
DELETE FROM "meta_escopos" WHERE "slug" IN ('espaco-seaway', 'espaco-sebrae', 'espaco-ayrton-senna');

-- DropIndex
DROP INDEX "meta_periodos_anoMes_idx";

-- DropIndex
DROP INDEX "meta_periodos_escopoId_anoMes_key";

-- AlterTable
ALTER TABLE "meta_periodos" DROP CONSTRAINT "meta_periodos_anoMes_formato";
ALTER TABLE "meta_periodos" RENAME COLUMN "anoMes" TO "anoTrimestre";

-- CreateIndex
CREATE INDEX "meta_periodos_anoTrimestre_idx" ON "meta_periodos"("anoTrimestre");

-- CreateIndex
CREATE UNIQUE INDEX "meta_periodos_escopoId_anoTrimestre_key" ON "meta_periodos"("escopoId", "anoTrimestre");

-- Formato de `anoTrimestre` garantido no BANCO, não só na action — mesmo
-- motivo do constraint que este substitui (ver comentário do model no schema).
ALTER TABLE "meta_periodos"
  ADD CONSTRAINT "meta_periodos_anoTrimestre_formato"
  CHECK ("anoTrimestre" ~ '^[0-9]{4}-Q[1-4]$');
