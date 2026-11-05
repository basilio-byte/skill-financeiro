-- ADR-0035 — central de exportação: rastro de quem baixou o quê.
--
-- SEGURANÇA: só ADITIVO. UMA tabela nova com dois índices, SEM chave estrangeira e sem relação com nenhuma
-- tabela existente — nenhuma linha existente é lida nem alterada, e nada aqui pode falhar por dado de produção
-- (lição do P3009 da ADR-0026, em que um ADD COLUMN NOT NULL sobre tabela populada derrubou o deploy; um CREATE
-- TABLE de nome inédito não tem como colidir com nada). Conferido antes: produção não tem tabela "exportacoes_log".

-- CreateTable
CREATE TABLE "exportacoes_log" (
    "id" TEXT NOT NULL,
    "quando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quem" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "conjunto" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "filtros" JSONB,
    "resumoFiltros" TEXT,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2),
    "dadosPessoais" BOOLEAN NOT NULL DEFAULT false,
    "resultado" TEXT NOT NULL,
    "erro" TEXT,
    "duracaoMs" INTEGER,

    CONSTRAINT "exportacoes_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exportacoes_log_quando_idx" ON "exportacoes_log"("quando");

-- CreateIndex
CREATE INDEX "exportacoes_log_conjunto_quando_idx" ON "exportacoes_log"("conjunto", "quando");
