-- ADR-0031 — espelho das cobranças em aberto e vencidas (página de inadimplentes).
--
-- SEGURANÇA: esta migration SÓ cria duas tabelas novas. Nenhum ALTER, nenhum DROP,
-- nenhum índice em tabela existente — não há como ela falhar por dado de produção
-- nem alterar uma linha de receita (lição do P3009 da ADR-0026, em que um ADD COLUMN
-- NOT NULL derrubou o deploy). Sem FK para as tabelas de receita.

CREATE TABLE "cobrancas_em_aberto" (
    "conexaId" INTEGER NOT NULL,
    "companyConexaId" INTEGER,
    "unidade" TEXT,
    "customerConexaId" INTEGER,
    "clienteNome" TEXT,
    "clienteFantasia" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL,
    "tipo" TEXT,
    "valor" DECIMAL(14,2) NOT NULL,
    "valorOriginal" DECIMAL(14,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "competencia" DATE,
    "atualizadoNoConexa" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobrancas_em_aberto_pkey" PRIMARY KEY ("conexaId")
);

CREATE INDEX "cobrancas_em_aberto_vencimento_idx" ON "cobrancas_em_aberto"("vencimento");
CREATE INDEX "cobrancas_em_aberto_customerConexaId_idx" ON "cobrancas_em_aberto"("customerConexaId");
CREATE INDEX "cobrancas_em_aberto_status_idx" ON "cobrancas_em_aberto"("status");

CREATE TABLE "inadimplencia_sync_runs" (
    "id" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "erro" TEXT,

    CONSTRAINT "inadimplencia_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inadimplencia_sync_runs_iniciadoEm_idx" ON "inadimplencia_sync_runs"("iniciadoEm");
