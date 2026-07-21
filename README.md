# skill-financeiro

Pipeline de categorização de receita **proprietário** da [Seahub Coworking](https://seahubcoworking.com.br),
integrado ao ERP **Conexa**. Porta a skill OpenClaw `categoriza-receita` (já validada pelo
time financeiro) para um app web: baixa Contas a Receber + Listar Vendas do Conexa
(filtrados por Data de Crédito da Cobrança), categoriza cada fatura contra uma tabela
editável, rateia faturas multi-categoria e gera uma planilha de saída — com histórico
consultável no próprio app.

> Sistema single-tenant, deploy isolado (banco/imagem/serviço próprios). Roda no Easypanel.

## Stack
Next.js 15 (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind · Vitest.

Fork enxuto do projeto irmão `seahub_financeiro` — reaproveita infra de deploy, auth,
aritmética monetária (Decimal.js) e o escritor de xlsx sem dependência. Ver
[`docs/context/decisions.md`](docs/context/decisions.md) (ADR-0001).

## Como funciona

```
Conexa (login web) ──export dinâmico──► xlsx (CR + LV) ──► parse ──► join (Cliente×mês)
   ──► categoriza (tabela editável) ──► rateio proporcional ──► Postgres ──► planilha/tela
```

Detalhes: [`docs/context/conexa-integration.md`](docs/context/conexa-integration.md) (como o
login/export funciona), [`docs/context/data-model.md`](docs/context/data-model.md) (fluxo de
uma rodada), [`docs/context/financial-rigor.md`](docs/context/financial-rigor.md) (regras de
rigor). **Memória de desenvolvimento em [`docs/context/`](docs/context/) — atualizar a cada
commit.**

## Desenvolvimento local

Pré-requisitos: Node 20+, Docker.

```bash
# 1. Dependências
npm install

# 2. Variáveis de ambiente
cp .env.example .env          # preencha CONEXA_WEB_USERNAME/PASSWORD e SESSION_SECRET

# 3. Banco de dados (Postgres via Docker)
docker compose up -d db

# 4. Migrations + tabela de categorias
npm run prisma:migrate
npm run db:seed-categories    # semeia a partir de prisma/seeds/categorizacao-inicial.csv (só na 1a vez — tabela vazia é a condição)

# 5. Primeiro admin (sem seed de dados fictícios)
ADMIN_EMAIL=voce@seahub.com ADMIN_PASSWORD=troque-esta-senha node scripts/bootstrap-admin.mjs

# 6. Rodar
npm run dev                   # http://localhost:3000
```

### Scripts
| Script | Ação |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | `prisma generate` + build de produção |
| `npm run test` | testes (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | cria/aplica migrations (dev) |
| `npm run prisma:deploy` | aplica migrations (produção) |
| `npm run db:seed-categories` | semeia a tabela de categorias a partir do CSV (só se estiver vazia) |

## CI/CD

`.github/workflows/docker-publish.yml` builda e publica a imagem no GHCR automaticamente a
cada push na `main` (e sob demanda via "Run workflow"). Publica sempre duas tags:
`ghcr.io/basilio-byte/skill-financeiro:latest` e `:<short-sha>` — nunca só `latest`, pra
sempre dar pra saber qual commit está rodando em produção (ver ADR-0007 em
[`docs/context/decisions.md`](docs/context/decisions.md)). Não precisa rodar `docker build`
manualmente — só dar push.

## Deploy no Easypanel

1. Serviço **Postgres** próprio (não compartilhar com `seahub_financeiro`).
2. Serviço **App** do tipo **Docker Image** → `ghcr.io/basilio-byte/skill-financeiro:latest`.
   O pacote é público — não precisa cadastrar credencial de registry (confirmado puxando o
   manifest sem autenticação; se um dia ficar privado, cadastre usuário GitHub + PAT
   `read:packages` no Easypanel).
3. **Secrets/env:** `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`),
   `CONEXA_BASE_URL`, `CONEXA_WEB_USERNAME`, `CONEXA_WEB_PASSWORD`, `APP_URL`,
   `APP_TIMEZONE=America/Fortaleza`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (só no primeiro boot —
   pode remover depois).
4. Porta do serviço: `3000`. Healthcheck: `GET /api/health`.
5. **Tudo automático no boot** (`docker-entrypoint.sh`): aplica migrations
   (`prisma migrate deploy`), cria o admin (se `ADMIN_EMAIL`/`ADMIN_PASSWORD` setados,
   idempotente) e semeia a tabela de categorias a partir do CSV (só se ela estiver vazia —
   depois disso é gerenciada por `/categorias`, sem sobrescrever edições manuais). Nenhum
   passo manual no primeiro deploy.
6. Para atualizar depois de um novo push: no Easypanel, "Redeploy" (ou configure
   auto-redeploy no push do `:latest`, se o Easypanel suportar watch de tag).

## Segurança
- Segredos só via env/secrets — nunca no repositório (`.env` é gitignored).
- `CONEXA_WEB_PASSWORD` é uma credencial de LOGIN real no Conexa — trate com o mesmo
  cuidado que a senha de um usuário humano (não é um token de API revogável).
- Sessões server-side revogáveis; senhas com bcrypt; auditoria de login.
