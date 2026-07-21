-- Achado por verificação adversarial (ADR-0013): uma linha órfã preservada por
-- ser revisada manualmente pode, mais tarde, coexistir com um bucket novo da
-- mesma fatura (quando a categoria "adivinhada" à mão ganha uma regra de
-- verdade) — dupla contagem que só um humano pode resolver. Este contador
-- torna essa situação visível no resumo de cada rodada, nunca silenciosa.
ALTER TABLE "revenue_sync_runs" ADD COLUMN "totalFaturasComConflito" INTEGER NOT NULL DEFAULT 0;
