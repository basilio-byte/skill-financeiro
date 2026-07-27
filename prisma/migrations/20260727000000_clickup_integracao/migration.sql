-- CreateTable
CREATE TABLE "clickup_vinculos" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "padroes" JSONB NOT NULL,
    "clickUpListId" TEXT NOT NULL,
    "clickUpTaskId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clickup_vinculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clickup_lista_cache" (
    "id" TEXT NOT NULL,
    "clickUpListId" TEXT NOT NULL,
    "camposPorMes" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clickup_lista_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clickup_push_logs" (
    "id" TEXT NOT NULL,
    "vinculoId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valorEnviado" DECIMAL(14,2) NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "erro" TEXT,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clickup_push_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clickup_vinculos_clickUpTaskId_key" ON "clickup_vinculos"("clickUpTaskId");

-- CreateIndex
CREATE INDEX "clickup_vinculos_clickUpListId_idx" ON "clickup_vinculos"("clickUpListId");

-- CreateIndex
CREATE INDEX "clickup_vinculos_categoria_idx" ON "clickup_vinculos"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "clickup_lista_cache_clickUpListId_key" ON "clickup_lista_cache"("clickUpListId");

-- CreateIndex
CREATE INDEX "clickup_push_logs_vinculoId_enviadoEm_idx" ON "clickup_push_logs"("vinculoId", "enviadoEm");

-- AddForeignKey
ALTER TABLE "clickup_vinculos" ADD CONSTRAINT "clickup_vinculos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clickup_push_logs" ADD CONSTRAINT "clickup_push_logs_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "clickup_vinculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nota (revisão adversarial 2026-07-27): NÃO existe CHECK valorEnviado >= 0
-- aqui de propósito. RevenueCategorizedLine.valorRecebidoCat pode ser
-- negativo (estorno/reembolso do cliente naquele mês), e este log precisa
-- registrar ISSO fielmente — um CHECK de não-negativo faria o próprio INSERT
-- do log falhar nesse mês (tanto o de sucesso quanto o fallback do catch),
-- e um push que de fato aconteceu ficaria sem nenhum rastro no banco,
-- exatamente o tipo de falha silenciosa que este log existe para evitar.
