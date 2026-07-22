#!/bin/sh
set -e

# Aplica migrations pendentes antes de subir a aplicação.
# Idempotente: não faz nada se já estiver em dia.
#
# Invocamos o CLI do Prisma direto pelo Node, a partir do diretório isolado
# `prisma-cli/` (ver Dockerfile, stage `prisma-cli`) — a imagem standalone não
# traz node_modules/.bin, então `npx prisma` falharia no boot.
PRISMA_CLI="./prisma-cli/node_modules/prisma/build/index.js"

if [ ! -f "$PRISMA_CLI" ]; then
  echo "[entrypoint] ERRO: CLI do Prisma não encontrado em $PRISMA_CLI" >&2
  exit 1
fi

echo "[entrypoint] Aplicando migrations do banco (prisma migrate deploy)..."
node "$PRISMA_CLI" migrate deploy

# Cria o primeiro administrador, se ADMIN_EMAIL/ADMIN_PASSWORD estiverem definidos.
# Idempotente: não faz nada se o usuário já existir (nunca sobrescreve a senha).
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Verificando usuário administrador..."
  node ./scripts/bootstrap-admin.mjs
fi

# Semeia a tabela de categorias a partir do CSV, só no primeiro boot (a
# tabela vazia é o sinal — depois disso ela é gerenciada por /categorias).
# Não derruba o container se falhar: preferimos subir com a tela de
# categorias vazia (corrigível na hora, via /categorias ou rodando o
# comando de novo) a travar toda a aplicação por causa de um CSV ruim.
echo "[entrypoint] Verificando tabela de categorias..."
node ./scripts/seed-categories.mjs || echo "[entrypoint] AVISO: seed de categorias falhou — cadastre manualmente em /categorias ou rode 'npm run db:seed-categories' de novo."

# Garante os escopos de meta (ADR-0016) a cada boot — ao contrário do seed de
# categorias, este roda SEMPRE, não só na primeira vez. O motivo é que aqui o
# código é a fonte de verdade da ESTRUTURA (quais escopos existem e quais
# categorias cada um soma), então uma versão nova que acrescente um escopo passa
# a valer no deploy, sem ninguém precisar rodar nada à mão.
#
# Seguro de repetir: só faz upsert de escopo e das categorias dele, e NUNCA
# encosta em MetaPeriodo — os valores de meta definidos em /metas ficam
# intactos. Também nunca remove escopo nem categoria.
echo "[entrypoint] Verificando escopos de meta..."
node ./scripts/seed-metas.mjs || echo "[entrypoint] AVISO: seed de metas falhou — o card de Metas fica vazio até rodar 'npm run db:seed-metas'."

echo "[entrypoint] Iniciando aplicação: $*"
exec "$@"
