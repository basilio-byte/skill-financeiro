-- Reintroduz meta MENSAL ao lado da trimestral (pedido explícito do usuário,
-- 2026-07-28: "as duas sejam visíveis/configuráveis"). Decisão do usuário
-- (confirmada via pergunta direta): as duas são SÉRIES INDEPENDENTES — mês
-- nunca é somado pra virar trimestre, nem trimestre é dividido pra virar mês.
-- Cada uma é um número que alguém define direto.
--
-- CORRIGIDO (mesmo dia, depois de uma 1ª tentativa falhar em produção com
-- P3009): a suposição original — "0 linhas em meta_periodos, nada a
-- preservar" — só tinha sido conferida no dev DB. Produção já tinha 1 meta
-- real (Q3 2026, R$35.000,00, definida às 11:52 UTC do mesmo dia, antes
-- deste deploy) quando a versão original tentou `ADD COLUMN ... NOT NULL`
-- sem DEFAULT numa tabela não-vazia — Postgres recusa isso, a migration
-- falhou inteira (transação revertida, nenhum dado tocado). Reescrita pra
-- funcionar com QUALQUER quantidade de linhas já existentes: adiciona as
-- colunas novas NULLABLE, faz backfill (toda linha que já existia até aqui
-- só podia ser trimestral — mensal não existia ainda — então
-- granularidade='TRIMESTRE' e periodoChave=o valor que já estava em
-- anoTrimestre), só then aperta pra NOT NULL e dropa a coluna antiga.
-- meta_escopos (1 linha) e meta_escopo_categorias (5 linhas) não são
-- tocados por esta migration.

-- CreateEnum
CREATE TYPE "MetaGranularidade" AS ENUM ('MES', 'TRIMESTRE');

-- DropIndex
DROP INDEX "meta_periodos_anoTrimestre_idx";

-- DropIndex
DROP INDEX "meta_periodos_escopoId_anoTrimestre_key";

-- AlterTable: "anoTrimestre" (só trimestre) vira "periodoChave" (mês OU
-- trimestre, dependendo de "granularidade"). Colunas novas entram NULLABLE
-- de propósito — uma tabela com linha real não aceita ADD COLUMN NOT NULL
-- sem DEFAULT numa única instrução.
ALTER TABLE "meta_periodos" ADD COLUMN "granularidade" "MetaGranularidade";
ALTER TABLE "meta_periodos" ADD COLUMN "periodoChave" TEXT;

-- Backfill: toda linha gravada até este ponto só pode ser trimestral (mensal
-- é reintroduzido só a partir desta migration) — "anoTrimestre" já é
-- exatamente o valor certo pra "periodoChave" nesse caso.
UPDATE "meta_periodos" SET "granularidade" = 'TRIMESTRE', "periodoChave" = "anoTrimestre";

-- Só agora, com toda linha já preenchida, aperta pra NOT NULL.
ALTER TABLE "meta_periodos" ALTER COLUMN "granularidade" SET NOT NULL;
ALTER TABLE "meta_periodos" ALTER COLUMN "periodoChave" SET NOT NULL;

ALTER TABLE "meta_periodos" DROP COLUMN "anoTrimestre";

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
