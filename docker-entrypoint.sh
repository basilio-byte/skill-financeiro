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

echo "[entrypoint] Iniciando aplicação: $*"
exec "$@"
