-- Passa a guardar o detalhe POR ITEM de cada linha categorizada (ADR-0028).
--
-- Motivo: o motor sempre calculou o valor de cada item da fatura (o array
-- `valoresPorItem` em categorize-invoices.ts), mas descartava esse detalhe ao
-- somar o bucket da categoria. Uma fatura com 3 salas virava UMA linha com os
-- nomes concatenados e um valor único — e a integração ClickUp, sem saber
-- dividir, era obrigada a creditar o valor inteiro a UM vínculo (o mais
-- antigo), atribuindo receita à sala errada. Medido em julho/2026: R$ 6.929,61
-- de atribuição arbitrária, 22,67% da categoria "Serviços de Espaço - Seaway
-- Center".
--
-- SEGURANÇA (lição do incidente P3009 de 2026-07-28, mesmo dia): as duas
-- colunas são NULLABLE e sem DEFAULT — `ADD COLUMN` nullable não reescreve nem
-- valida linhas existentes, então isto roda sem risco numa tabela com dado
-- (revenue_categorized_lines tem milhares de linhas em produção). Nenhum valor
-- já gravado é lido, recalculado ou tocado por esta migration.
--
-- Linhas antigas ficam com `itensDetalhe = NULL` para sempre (o detalhe delas
-- não existe mais em lugar nenhum — os exports de LV nunca foram persistidos).
-- Quem consome PRECISA tratar a ausência; ver o fallback em composicao.ts.

-- AlterTable
ALTER TABLE "revenue_categorized_lines" ADD COLUMN     "ajusteArredondamento" DECIMAL(14,2),
ADD COLUMN     "itensDetalhe" JSONB;
