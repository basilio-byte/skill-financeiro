-- ADR-0033 — tokens pessoais e auditoria do MCP.
--
-- SEGURANÇA: só CREATE (um tipo e duas tabelas novas). Nenhum ALTER/DROP em tabela
-- existente, então não há como falhar por dado de produção nem alterar receita
-- (lição do P3009, ADR-0026). A única FK é tokens_mcp -> users, e ela mora na tabela
-- NOVA: a tabela users não ganha coluna nenhuma.

CREATE TYPE "EscopoToken" AS ENUM ('LEITURA', 'ESCRITA');

CREATE TABLE "tokens_mcp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "escopo" "EscopoToken" NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "revogadoPor" TEXT,

    CONSTRAINT "tokens_mcp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tokens_mcp_hash_key" ON "tokens_mcp"("hash");
CREATE INDEX "tokens_mcp_userId_idx" ON "tokens_mcp"("userId");

ALTER TABLE "tokens_mcp" ADD CONSTRAINT "tokens_mcp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auditoria_mcp" (
    "id" TEXT NOT NULL,
    "quando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quem" TEXT NOT NULL,
    "tokenId" TEXT,
    "ferramenta" TEXT NOT NULL,
    "escrita" BOOLEAN NOT NULL,
    "argumentos" JSONB,
    "resultado" TEXT NOT NULL,
    "erro" TEXT,
    "detalhe" JSONB,
    "duracaoMs" INTEGER,

    CONSTRAINT "auditoria_mcp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auditoria_mcp_quando_idx" ON "auditoria_mcp"("quando");
CREATE INDEX "auditoria_mcp_ferramenta_idx" ON "auditoria_mcp"("ferramenta");
CREATE INDEX "auditoria_mcp_escrita_quando_idx" ON "auditoria_mcp"("escrita", "quando");
