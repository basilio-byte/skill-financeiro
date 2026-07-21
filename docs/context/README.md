# Memória de desenvolvimento — skill-financeiro

Esta pasta é a memória viva do projeto. Regra permanente (aplicada pelo
`.githooks/pre-commit`): **atualizar `progress.md` a cada commit** (e
`decisions.md` quando uma decisão arquitetural mudar).

- [`financial-rigor.md`](financial-rigor.md) — regras não-negociáveis de dinheiro/datas/auditoria.
- [`decisions.md`](decisions.md) — ADRs numeradas.
- [`conexa-integration.md`](conexa-integration.md) — como o login web e os exports do Conexa funcionam.
- [`data-model.md`](data-model.md) — entidades do Prisma e o que cada uma representa.
- [`progress.md`](progress.md) — log cronológico de decisões e marcos.

Projeto irmão: `seahub_financeiro` (Next.js/Prisma/Postgres, dashboard financeiro completo
da Seahub, já em produção). Este repo nasceu como um fork enxuto dele — ver ADR-0001.
