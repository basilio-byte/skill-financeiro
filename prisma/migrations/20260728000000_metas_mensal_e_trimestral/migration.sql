-- Reintroduz meta MENSAL ao lado da trimestral (pedido explícito do usuário,
-- 2026-07-28: "as duas sejam visíveis/configuráveis"). Decisão do usuário
-- (confirmada via pergunta direta): as duas são SÉRIES INDEPENDENTES — mês
-- nunca é somado pra virar trimestre, nem trimestre é dividido pra virar mês.
-- Cada uma é um número que alguém define direto.
--
-- Nenhuma meta de VALOR foi definida desde a virada pra trimestral em
-- 2026-07-24 (confirmado: 0 linhas em meta_periodos, 0 em meta_periodo_events,
-- em produção e dev) — por isso não há dado de período/valor pra preservar ou
-- migrar. meta_escopos (1 linha) e meta_escopo_categorias (5 linhas) não são
-- tocados por esta migration.

-- CreateEnum
CREATE TYPE "MetaGranularidade" AS ENUM ('MES', 'TRIMESTRE');

-- DropIndex
DROP INDEX "meta_periodos_anoTrimestre_idx";

-- DropIndex
DROP INDEX "meta_periodos_escopoId_anoTrimestre_key";

-- AlterTable: "anoTrimestre" (só trimestre) vira "periodoChave" (mês OU
-- trimestre, dependendo de "granularidade"). DROP+ADD em vez de RENAME (ao
-- contrário da migration anterior) porque o significado da coluna mudou de
-- verdade — não é mais sempre um trimestre.
ALTER TABLE "meta_periodos" DROP COLUMN "anoTrimestre",
ADD COLUMN     "granularidade" "MetaGranularidade" NOT NULL,
ADD COLUMN     "periodoChave" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "meta_periodos_granularidade_periodoChave_idx" ON "meta_periodos"("granularidade", "periodoChave");

-- CreateIndex
CREATE UNIQUE INDEX "meta_periodos_escopoId_granularidade_periodoChave_key" ON "meta_periodos"("escopoId", "granularidade", "periodoChave");

-- Formato de "periodoChave" garantido no BANCO, não só na action — mesmo
-- motivo do constraint que isto substitui (ver comentário do model no
-- schema). O CHECK é composto: a granularidade decide qual formato vale, e
-- os dois formatos nunca se confundem entre si (um tem "-Q", o outro não).
ALTER TABLE "meta_periodos"
  ADD CONSTRAINT "meta_periodos_periodo_formato"
  CHECK (
    ("granularidade" = 'TRIMESTRE' AND "periodoChave" ~ '^[0-9]{4}-Q[1-4]$')
    OR
    ("granularidade" = 'MES' AND "periodoChave" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  );
