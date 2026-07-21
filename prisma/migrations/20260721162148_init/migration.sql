-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "Proporcionado" AS ENUM ('N', 'S', 'SEM_LV');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_category_rules" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_categorization_runs" (
    "id" TEXT NOT NULL,
    "periodoInicio" DATE NOT NULL,
    "periodoFim" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "executadoPorId" TEXT,
    "totalLinhasCR" INTEGER NOT NULL DEFAULT 0,
    "totalLinhasLV" INTEGER NOT NULL DEFAULT 0,
    "totalSemLV" INTEGER NOT NULL DEFAULT 0,
    "totalRecebido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "resumoPorCategoria" JSONB,
    "erro" TEXT,

    CONSTRAINT "revenue_categorization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_categorized_lines" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "crConexaId" INTEGER NOT NULL,
    "unidade" TEXT,
    "faturamento" TEXT,
    "clienteConexaId" INTEGER,
    "cpfCnpj" TEXT,
    "razaoSocial" TEXT,
    "planoContratado" TEXT,
    "categoria" TEXT NOT NULL,
    "proporcionado" "Proporcionado" NOT NULL,
    "tipo" TEXT,
    "status" TEXT,
    "parcela" TEXT,
    "valorRecebidoCat" DECIMAL(14,2) NOT NULL,
    "valorRecebidoTotal" DECIMAL(14,2) NOT NULL,
    "valorBruto" DECIMAL(14,2),
    "valorDesconto" DECIMAL(14,2),
    "vencimento" DATE,
    "quitacao" DATE,
    "competencia" DATE,
    "emissao" DATE,
    "dataCredito" DATE,
    "conta" TEXT,
    "observacoes" TEXT,
    "tags" TEXT,
    "raw" JSONB NOT NULL,

    CONSTRAINT "revenue_categorized_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "login_events_email_idx" ON "login_events"("email");

-- CreateIndex
CREATE INDEX "login_events_createdAt_idx" ON "login_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_category_rules_nome_key" ON "revenue_category_rules"("nome");

-- CreateIndex
CREATE INDEX "revenue_category_rules_categoria_idx" ON "revenue_category_rules"("categoria");

-- CreateIndex
CREATE INDEX "revenue_categorization_runs_periodoInicio_periodoFim_idx" ON "revenue_categorization_runs"("periodoInicio", "periodoFim");

-- CreateIndex
CREATE INDEX "revenue_categorized_lines_runId_idx" ON "revenue_categorized_lines"("runId");

-- CreateIndex
CREATE INDEX "revenue_categorized_lines_clienteConexaId_idx" ON "revenue_categorized_lines"("clienteConexaId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_categorization_runs" ADD CONSTRAINT "revenue_categorization_runs_executadoPorId_fkey" FOREIGN KEY ("executadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_categorized_lines" ADD CONSTRAINT "revenue_categorized_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "revenue_categorization_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
