-- ADR-0029 — o MÊS do crédito entra na identidade da linha de receita.
--
-- Motivo (medido em produção, não suposto): cobrança recorrente tem uma LISTA de
-- datas de crédito, uma por parcela, e entrega o mesmo valor em cada mês. Com a
-- chave (crConexaId, chaveLinha), a rodada de agosto reescrevia a dataCredito da
-- linha de julho e a receita MIGRAVA de mês — 10 faturas, R$ 1.097,07, todas no
-- dia exato previsto pela lista de datas.
--
-- SEGURANÇA DESTA MIGRATION, na ordem em que os passos importam:
--
--  1. ADD COLUMN NULLABLE não reescreve a tabela (metadado só, PG 11+) e não pode
--     falhar por dado existente. É a lição do P3009 da ADR-0026, em que um
--     ADD COLUMN NOT NULL sem default derrubou o deploy porque a migration tinha
--     sido validada contra banco VAZIO e produção tinha uma linha real.
--  2. Backfill e só então NOT NULL. Se sobrar qualquer NULL, o passo 3 falha alto
--     em vez de deixar a coluna meio preenchida.
--  3. O índice único novo é criado ANTES de o antigo cair, e a criação falha se
--     houver duplicata — conferido antes pelo snapshot da Fase 0 (seção 5:
--     "NENHUMA colisão"), contra o dado REAL de produção, não contra dev.
--
-- Nenhuma linha existente muda de valor, de categoria ou de data. A coluna nova é
-- derivada de dado que já está na própria linha.

-- 1. Coluna nullable primeiro.
ALTER TABLE "revenue_categorized_lines" ADD COLUMN "mesCredito" TEXT;

-- 2. Backfill a partir da própria dataCredito.
--    to_char sobre `date` não tem fuso envolvido: a coluna é DATE, sem hora, e a
--    conversão é textual. É a mesma régua que mesDoCredito() usa em UTC no TS.
UPDATE "revenue_categorized_lines"
   SET "mesCredito" = to_char("dataCredito", 'YYYY-MM')
 WHERE "dataCredito" IS NOT NULL;

-- 2b. Rede de segurança para linha sem dataCredito. O snapshot de produção
--     (2026-08-04) mostrou ZERO dessas, e o motor filtra `dataCredito !== null`
--     antes de persistir — mas a coluna é nullable no schema, então NÃO assumimos.
--     '0000-00' é deliberadamente inválido como mês: se algum dia aparecer na
--     tela ou numa conferência, é um sinal alto de que uma linha entrou sem data,
--     não um valor que se confunde com mês de verdade.
UPDATE "revenue_categorized_lines"
   SET "mesCredito" = '0000-00'
 WHERE "mesCredito" IS NULL;

-- 3. Agora sim, obrigatória.
ALTER TABLE "revenue_categorized_lines" ALTER COLUMN "mesCredito" SET NOT NULL;

-- 4. Índice novo primeiro (falha aqui = duplicata; nada foi destruído ainda).
CREATE UNIQUE INDEX "revenue_categorized_lines_crConexaId_chaveLinha_mesCredito_key"
    ON "revenue_categorized_lines" ("crConexaId", "chaveLinha", "mesCredito");

CREATE INDEX "revenue_categorized_lines_mesCredito_idx"
    ON "revenue_categorized_lines" ("mesCredito");

-- 5. Só então o índice antigo sai.
DROP INDEX "revenue_categorized_lines_crConexaId_chaveLinha_key";
