# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:22-alpine AS base
# libc compat p/ Prisma engines no Alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Gera o Prisma Client e o build standalone do Next.
RUN npx prisma generate && npm run build

# ---- CLI do Prisma (isolado) ----
# O entrypoint roda `migrate deploy` no boot, então o CLI é dependência de
# RUNTIME. O bundle standalone do Next não traz node_modules/.bin nem as deps
# transitivas do CLI — instalamos o CLI num diretório próprio para que a
# resolução de módulos dele funcione sem colidir com o bundle da aplicação.
# A versão vem do package-lock — nunca "a mais recente" — para não divergir do
# @prisma/client gerado no builder.
FROM base AS prisma-cli
WORKDIR /cli
COPY package-lock.json ./lock.json
RUN PV=$(node -p "require('/cli/lock.json').packages['node_modules/prisma'].version") \
  && echo '{"name":"prisma-cli","private":true}' > package.json \
  && npm install --no-save --no-audit --no-fund "prisma@$PV" \
  && rm -f lock.json

# ---- Runner (produção) ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Artefatos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma: schema + migrations + seeds (para o migrate deploy e o seed de categorias)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# CLI do Prisma isolado, com as próprias deps (ver stage prisma-cli).
COPY --from=prisma-cli /cli/node_modules ./prisma-cli/node_modules

# Scripts de bootstrap (produção) + bcryptjs, que o Next embute no bundle do
# servidor e portanto não fica disponível em node_modules para scripts avulsos.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
