-- Escopo de meta que soma TODA a receita do período, sem filtrar categoria
-- (pedido da Duda, 2026-07-28: "trimestral eu queria colocar valor recebido,
-- sem categorizar sabe? como meta").
--
-- Por que uma FLAG e não um escopo com todas as categorias listadas: a tabela
-- de categorias é editável em /categorias e cresce com o tempo, então uma lista
-- fixa deixaria de fora, em silêncio, toda categoria criada depois — o mesmo
-- modo de falha da ADR-0017. Com a flag, o escopo soma o que existir hoje e o
-- que existir amanhã, sem manutenção.
--
-- SEGURANÇA: `ADD COLUMN ... NOT NULL DEFAULT false` é alteração só de metadado
-- no Postgres 11+ (default não-volátil não reescreve a tabela), então roda sem
-- risco em `meta_escopos` já populada. Nenhuma linha existente muda de
-- comportamento: todas nascem com `false`, que é exatamente o que elas são
-- hoje (escopos por categoria).

-- AlterTable
ALTER TABLE "meta_escopos" ADD COLUMN     "todasCategorias" BOOLEAN NOT NULL DEFAULT false;
