-- CreateTable
CREATE TABLE "meta_escopos" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_escopos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_escopo_categorias" (
    "id" TEXT NOT NULL,
    "escopoId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_escopo_categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_periodos" (
    "id" TEXT NOT NULL,
    "escopoId" TEXT NOT NULL,
    "anoMes" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "definidoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_periodos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_periodo_events" (
    "id" TEXT NOT NULL,
    "metaPeriodoId" TEXT NOT NULL,
    "valorAnterior" DECIMAL(14,2),
    "valorNovo" DECIMAL(14,2) NOT NULL,
    "alteradoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_periodo_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_escopos_slug_key" ON "meta_escopos"("slug");

-- CreateIndex
CREATE INDEX "meta_escopos_ativo_ordem_idx" ON "meta_escopos"("ativo", "ordem");

-- CreateIndex
CREATE INDEX "meta_escopo_categorias_categoria_idx" ON "meta_escopo_categorias"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "meta_escopo_categorias_escopoId_categoria_key" ON "meta_escopo_categorias"("escopoId", "categoria");

-- CreateIndex
CREATE INDEX "meta_periodos_anoMes_idx" ON "meta_periodos"("anoMes");

-- CreateIndex
CREATE UNIQUE INDEX "meta_periodos_escopoId_anoMes_key" ON "meta_periodos"("escopoId", "anoMes");

-- CreateIndex
CREATE INDEX "meta_periodo_events_metaPeriodoId_criadoEm_idx" ON "meta_periodo_events"("metaPeriodoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "meta_escopo_categorias" ADD CONSTRAINT "meta_escopo_categorias_escopoId_fkey" FOREIGN KEY ("escopoId") REFERENCES "meta_escopos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_periodos" ADD CONSTRAINT "meta_periodos_escopoId_fkey" FOREIGN KEY ("escopoId") REFERENCES "meta_escopos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_periodos" ADD CONSTRAINT "meta_periodos_definidoPorId_fkey" FOREIGN KEY ("definidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_periodo_events" ADD CONSTRAINT "meta_periodo_events_metaPeriodoId_fkey" FOREIGN KEY ("metaPeriodoId") REFERENCES "meta_periodos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_periodo_events" ADD CONSTRAINT "meta_periodo_events_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Formato de `anoMes` garantido no BANCO, não só na action.
-- Um "2026-7" ou "07/2026" gravado por qualquer caminho (script, import, bug de
-- UI) nunca casaria com o resolver de período, e a meta sumiria da tela sem
-- erro nenhum — o tipo de falha silenciosa que financial-rigor.md proíbe.
ALTER TABLE "meta_periodos"
  ADD CONSTRAINT "meta_periodos_anoMes_formato"
  CHECK ("anoMes" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Meta não pode ser negativa. Zero é permitido no banco (a UI trata "0" como
-- "sem meta definida"), mas valor negativo não tem significado nenhum aqui.
ALTER TABLE "meta_periodos"
  ADD CONSTRAINT "meta_periodos_valor_nao_negativo"
  CHECK ("valor" >= 0);
