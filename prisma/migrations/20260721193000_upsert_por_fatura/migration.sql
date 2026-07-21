-- ===========================================================================
-- Upsert por fatura + sincronização automática (ADR-0013).
--
-- Contexto: o modelo antigo criava um conjunto novo e imutável de
-- RevenueCategorizedLine a cada rodada (append-only). Com sincronização
-- automática a cada 15 min (ver src/lib/scheduler/auto-sync.ts), isso cresce
-- sem limite. Esta migração troca para upsert por fatura: cada bucket
-- (crConexaId, chaveLinha) tem UMA linha atual, atualizada in-place.
--
-- Ainda não há dado de produção real (Easypanel não configurado) — só o
-- banco de dev local tem dados de teste reais do Conexa — mas a migração é
-- escrita de forma genérica (backfill + dedupe), não como um "wipe", porque
-- documenta o comportamento correto para quando isso rodar contra dado real.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Renomeia a tabela de rodadas (RevenueCategorizationRun -> RevenueSyncRun)
--    preservando os dados/histórico — ela deixa de ser dona exclusiva das
--    linhas que produziu, mas continua sendo o log de execuções.
-- ---------------------------------------------------------------------------
ALTER TABLE "revenue_categorization_runs" RENAME TO "revenue_sync_runs";
ALTER TABLE "revenue_sync_runs" RENAME CONSTRAINT "revenue_categorization_runs_pkey" TO "revenue_sync_runs_pkey";
ALTER TABLE "revenue_sync_runs" RENAME CONSTRAINT "revenue_categorization_runs_executadoPorId_fkey" TO "revenue_sync_runs_executadoPorId_fkey";
ALTER INDEX "revenue_categorization_runs_periodoInicio_periodoFim_idx" RENAME TO "revenue_sync_runs_periodoInicio_periodoFim_idx";

-- CreateEnum
CREATE TYPE "OrigemRodada" AS ENUM ('MANUAL', 'AUTOMATICO');

-- AlterTable: origem (MANUAL disparada por usuário vs AUTOMATICO pelo
-- agendador) + contadores de auditoria do upsert (nunca fica silencioso
-- quanto a linhas órfãs preservadas — financial-rigor.md #8/#10).
ALTER TABLE "revenue_sync_runs"
  ADD COLUMN "origem" "OrigemRodada" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "totalLinhasNovas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalLinhasAtualizadas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalLinhasOrfasPreservadas" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "revenue_sync_runs_status_idx" ON "revenue_sync_runs"("status");

-- ---------------------------------------------------------------------------
-- 2. chaveLinha: identidade estável do bucket dentro de uma fatura (mesma
--    fórmula de src/lib/categorization/categorize-invoices.ts). Backfill usa
--    COALESCE("categoriaOriginal", "categoria") — categoriaOriginal é o que a
--    SKILL calculou antes de qualquer revisão manual; usar "categoria" direto
--    aqui pegaria, para linhas já revisadas, o valor SOBRESCRITO pelo humano,
--    quebrando a identidade do bucket original.
-- ---------------------------------------------------------------------------
ALTER TABLE "revenue_categorized_lines" ADD COLUMN "chaveLinha" TEXT;

UPDATE "revenue_categorized_lines"
SET "chaveLinha" = CASE
  WHEN COALESCE("categoriaOriginal", "categoria") = 'Sem Categoria'
    THEN 'Sem Categoria::' || COALESCE("servicoOuPlano", '')
  ELSE COALESCE("categoriaOriginal", "categoria")
END;

ALTER TABLE "revenue_categorized_lines" ALTER COLUMN "chaveLinha" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. O modelo antigo permitia várias linhas para o MESMO bucket entre
--    rodadas que se sobrepõem (ADR-0012). Antes de criar a constraint única
--    (crConexaId, chaveLinha), reduz a UMA linha por bucket, com a MESMA
--    prioridade já usada em linhasDeduplicadasPorFatura: revisão manual mais
--    recente vence; sem revisão nenhuma, a rodada concluída mais recente vence.
-- ---------------------------------------------------------------------------
DELETE FROM "revenue_categorized_lines" l
USING (
  SELECT l2."id",
    ROW_NUMBER() OVER (
      PARTITION BY l2."crConexaId", l2."chaveLinha"
      ORDER BY
        l2."revisadoManualmente" DESC,
        l2."revisadoEm" DESC NULLS LAST,
        r."concluidoEm" DESC NULLS LAST,
        r."id" DESC
    ) AS rn
  FROM "revenue_categorized_lines" l2
  JOIN "revenue_sync_runs" r ON r."id" = l2."runId"
) ranked
WHERE l."id" = ranked."id" AND ranked."rn" > 1;

-- ---------------------------------------------------------------------------
-- 4. runId -> ultimaRodadaId: a linha não pertence mais a UMA rodada
--    exclusivamente (upsert por fatura) — o campo agora só registra qual foi
--    a última rodada que a tocou. Após a dedupe acima, é a rodada vencedora.
-- ---------------------------------------------------------------------------
ALTER TABLE "revenue_categorized_lines" RENAME COLUMN "runId" TO "ultimaRodadaId";
ALTER TABLE "revenue_categorized_lines" ADD COLUMN "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "revenue_categorized_lines" ALTER COLUMN "atualizadoEm" DROP DEFAULT;

-- DropForeignKey (era ON DELETE CASCADE — a linha não é mais "dona" de uma
-- única rodada, então apagar uma rodada nunca pode apagar linhas em cascata)
ALTER TABLE "revenue_categorized_lines" DROP CONSTRAINT "revenue_categorized_lines_runId_fkey";

-- DropIndex (índices antigos, cobertos/substituídos pelos novos abaixo)
DROP INDEX "revenue_categorized_lines_runId_idx";
DROP INDEX "revenue_categorized_lines_crConexaId_idx";

-- CreateIndex
CREATE INDEX "revenue_categorized_lines_dataCredito_idx" ON "revenue_categorized_lines"("dataCredito");

-- CreateIndex (a chave que o upsert usa para encontrar a mesma linha entre rodadas)
CREATE UNIQUE INDEX "revenue_categorized_lines_crConexaId_chaveLinha_key" ON "revenue_categorized_lines"("crConexaId", "chaveLinha");

-- AddForeignKey (RESTRICT: nunca apagar uma rodada ainda referenciada por linhas)
ALTER TABLE "revenue_categorized_lines" ADD CONSTRAINT "revenue_categorized_lines_ultimaRodadaId_fkey" FOREIGN KEY ("ultimaRodadaId") REFERENCES "revenue_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
