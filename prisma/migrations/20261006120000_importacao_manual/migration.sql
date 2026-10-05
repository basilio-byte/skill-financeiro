-- ADR-0034 — importação manual dos exports do Conexa (a receita não pode mais ser baixada
-- por login web: o Conexa passou a exigir reCAPTCHA).
--
-- SEGURANÇA: só ADITIVO. Um valor novo no enum de origem e UMA coluna NULLABLE sem default
-- (identificação dos arquivos importados: nome, tamanho, hash — nunca o conteúdo). Nenhuma
-- linha existente é lida nem alterada, e nada aqui pode falhar por dado de produção (lição do
-- P3009 da ADR-0026, em que um ADD COLUMN NOT NULL derrubou o deploy).

ALTER TYPE "OrigemRodada" ADD VALUE 'IMPORTACAO';

ALTER TABLE "revenue_sync_runs" ADD COLUMN "entradaManual" JSONB;
