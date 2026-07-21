# Progresso

## 2026-07-21 — Fundação do projeto
- Repo `skill-financeiro` clonado (vazio) para hospedar um novo pipeline de categorização
  de receita para a Seahub Coworking, com a skill OpenClaw `categoriza-receita` (já validada
  pelo time financeiro) como pilar principal.
- Mapeado o projeto irmão `seahub_financeiro` (multi-agente) para decidir o que reaproveitar:
  stack (Next.js/Prisma/Postgres/Docker/Easypanel), auth, money.ts, allocateProportionally,
  xlsx writer, convenção `docs/context/`.
- Achado crítico: "Data de Crédito da Cobrança" não existe na API REST v2 do Conexa — só na
  tela de export manual. Isso descartou a ideia inicial de reaproveitar o `CONEXA_API_TOKEN`
  do projeto irmão como mecanismo de ingestão.
- Usuário propôs e validamos AO VIVO (login real + download real contra
  `seahubcoworking.conexa.app`) um cliente de ingestão via login web (sessão) + export
  parametrizado por data — funciona, devolve xlsx real. Ver ADR-0002 e conexa-integration.md.
- Decisões fechadas: v1 enxuto (só o pipeline, não as 9 telas do projeto irmão); deploy
  100% isolado; persistir cada rodada no Postgres; tabela de categorias editável no app,
  semeada do CSV real da Duda (`Categorizacao.xlsx`, 344 linhas).
- Implementado nesta sessão: schema Prisma (auth + RevenueCategoryRule/Run/Line), xlsx
  reader sem dependência (validado contra arquivos reais), cliente conexa-web, motor de
  categorização (rules/join/rateio/categorize-invoices/run), telas (login/runs/categorias/
  minha-conta), infra Docker, seed de categorias.
- **Concluído ainda em 2026-07-21:** `npm install`, `typecheck`/`test` (23 testes)/`build`
  limpos; `xlsx/reader.ts` validado contra os dois arquivos reais baixados (1372 linhas
  Vendas, 739 linhas CR); rodada real de ponta a ponta via `POST /api/runs` contra o Conexa
  de produção (01–21/07/2026): 684 faturas CR, 1252 itens LV, 40 sem LV, R$258.121,80 —
  QA da skill original bateu exato (soma "Valor Recebido Cat." = soma "Valor Recebido
  Total" por fatura). Export `.xlsx` confirmado como Excel 2007+ real.
- Primeiro commit + push feito (`e00b767`). Adicionado `.github/workflows/docker-publish.yml`
  (ADR-0007): publica `ghcr.io/basilio-byte/skill-financeiro` automaticamente a cada push
  na `main`, com tags `latest` + short-sha.
- Push confirmado publicamente e workflow rodou com sucesso: `ghcr.io/basilio-byte/skill-financeiro`
  está publicado e é **pull público** (confirmado puxando o manifest sem autenticação) —
  Easypanel não precisa de credencial de registry. Snag de autenticação no meio do caminho:
  Git Credential Manager local estava logado como `basiliolp`, sem push em
  `basilio-byte/skill-financeiro` — resolvido pelo usuário adicionando `basiliolp` como
  colaborador do repo.
- Automatizado o resto do boot (pedido do usuário, "tudo automático"): `prisma/seed-categories.ts`
  virou `scripts/seed-categories.mjs` (JS puro, sem tsx — precisa rodar na imagem de
  produção, que não carrega TypeScript) e passou a rodar sozinho no
  `docker-entrypoint.sh`, mas só semeia se a tabela estiver vazia (ADR-0008) — nunca
  reaplica o CSV por cima de edições manuais feitas em `/categorias`. Primeiro deploy no
  Easypanel agora não tem NENHUM passo manual (migrations + admin + categorias, tudo no boot).
- Ideia em aberto, não implementada: um segundo job de CI que chame o webhook de redeploy
  do Easypanel automaticamente após o build (precisa da URL/token do webhook, que o
  usuário ainda não passou).

## 2026-07-21 (cont.) — Layout do projeto irmão, rebrand e telas novas
- Pedido do usuário: copiar o layout do `seahub_financeiro` (logo/gráficos), renomear o
  produto de "skill-financeiro" para "Financeiro Seahub" dentro do app, criar a tela de
  Contas, e tornar visíveis os dados brutos dos itens "Sem Categoria" para permitir
  cadastro manual (auditoria) que já vale para rodadas futuras.
- Reaproveitado do projeto irmão: `public/logo.png`, paleta Tailwind `seahub-*`,
  `components/ui.tsx` (Card/SectionTitle), `KpiCard`, `ChartCard` (tabela gêmea acessível),
  `BreakdownList`, e a tela `/contas` inteira com `user-actions.ts`/`user-guards.ts`
  (guardas: nunca sem admin ativo, ninguém se tranca fora) — ver ADR-0009.
- Adaptado (não copiado 1:1): paleta de gráficos virou só `MAGNITUDE` (ranking de
  categoria/conta) — não há `SERIES`/`DIVERGING` porque este app não tem despesa nem
  polaridade, só receita categorizada.
- Nova tela `/` (Panorama): KPIs (total categorizado, sem categoria %, rodadas, regras
  ativas), gráfico de total recebido por rodada (série única), breakdowns por categoria e
  por conta, últimas rodadas. Agregação em `src/lib/reports/overview.ts`.
- Schema: `RevenueCategorizedLine.servicoOuPlano` (novo campo, migration
  `20260721174037_add_servico_ou_plano`) guarda o nome exato buscado contra as regras —
  base da nova seção "Pendências de categorização" em `/categorias`, que agrupa por nome
  as linhas "Sem Categoria", mostra amostras (cliente/competência/valor) e tem um form
  pré-preenchido para cadastrar a categoria ali mesmo. Detalhe de correção: quando uma
  fatura tem múltiplos itens SEM categoria e nomes DIFERENTES, `categorize-invoices.ts`
  agora agrupa por `(categoria, nome)` em vez de só `categoria` — sem isso, dois serviços
  diferentes não mapeados na mesma fatura se fundiam numa linha só e a auditoria perdia
  informação.
- **Pendente para a próxima sessão:** configurar de fato o serviço no Easypanel (Postgres +
  App apontando pro GHCR + envs), testar a UI num navegador de verdade (só validada via
  build/typecheck/testes — Panorama/Contas/Pendências ainda não foram clicadas numa tela).

## 2026-07-21 (cont. 2) — Revisão manual de linhas + Panorama por período
- Pedido do usuário: (1) "Faturas para revisar" precisa ter campos editáveis (categoria,
  valor) — hoje é só uma listagem que nunca pode ser ajustada; (2) regra permanente: tudo
  (cálculo, categoria, valores, dashboard) segue a skill categoriza-receita à risca, a ÚNICA
  exceção é dado ajustado manualmente ("revisado"); (3) visualização de dados
  semanal/mensal/trimestral/semestral/anual.
- Schema (`20260721181630_revisao_manual_linha`): `RevenueCategorizedLine` ganha
  `revisadoManualmente`/`revisadoPorId`/`revisadoEm` + snapshot `categoriaOriginal`/
  `valorRecebidoCatOriginal` (preenchido só na primeira revisão, nunca depois — é a
  referência permanente do que a skill calculou). Ver ADR-0010.
- `updateCategorizedLineAction` (ADMIN only): edita categoria/valor de uma linha e, na MESMA
  transação, recalcula `resumoPorCategoria`/`totalRecebido` da rodada a partir de todas as
  linhas — Panorama e o resumo da rodada nunca ficam dessincronizados de uma revisão feita.
  UI: `LinhaRevisaoRow` (componente client, expande um form inline por linha) em
  `/runs/[id]`.
- `src/lib/dates.ts` novo: portado o `getPeriodBounds`/`PeriodControls` do projeto irmão
  (que só tinha dia/semana/mês/ano) e estendido com trimestre e semestre (usando
  `date-fns`, já era dependência não usada). 12 testes cobrindo os limites de cada
  granularidade + a regressão de fuso que o projeto irmão já documentou (não deslizar um
  dia ao interpretar `ref=2026-01-01`).
- `src/lib/reports/overview.ts` reescrito: `buildOverview(kind, ref)` agora escopa KPIs e
  os breakdowns (categoria/conta) a UM período selecionado (filtrando por `dataCredito`),
  com uma tendência dos últimos 12 buckets da mesma granularidade numa única query (janela
  ampla, agregada em memória). "Últimas rodadas" continua global. Ver ADR-0011.
- Validado: `typecheck`/`test` (48 testes, todos passando, +12 de dates.test.ts)/`build`
  limpos.
- **Pendente para a próxima sessão:** testar a revisão manual e os filtros de período
  clicando de verdade numa rodada real (só chegou a typecheck/test/build nesta sessão até
  aqui); Easypanel; clique-a-clique num navegador real (segue pendente de sessões
  anteriores).
