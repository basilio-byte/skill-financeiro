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
  limpos; e, ainda na mesma sessão, revisão manual e os 5 filtros de período foram
  confirmados contra dado real (simulação da transação de revisão + curl em todas as
  granularidades batendo com soma direta em SQL) antes do commit `ab2d9ad`. Commit + push
  feitos, imagem publicada no GHCR.
- Pendente: Easypanel; clique-a-clique num navegador real (o usuário testou isso na sessão
  seguinte e achou o bug de soma entre rodadas registrado abaixo).

## 2026-07-21 (cont. 3) — Bug real em produção: rodadas sobrepostas somavam no Panorama
- O usuário testou a aplicação num navegador de verdade (primeira vez) e, ao criar várias
  rodadas para o mesmo período (testando o fluxo), viu o total do Panorama crescer a cada
  rodada nova — 3 rodadas do período 01–19/07 estavam somando 3x. Reportou com prints reais.
- Causa raiz e correção: ver ADR-0012 e financial-rigor.md #10.
  `linhasDeduplicadasPorFatura()` (SQL raw, `DISTINCT ON` por `crConexaId`, rodada concluída
  mais recente vence) substitui a soma cega de todas as linhas de todas as rodadas na janela.
  Novo índice `@@index([crConexaId])` (migration `20260721184331_index_cr_conexa_id`).
- Validado contra os dados JÁ duplicados no banco local (2 rodadas do mesmo período,
  01–21/07/2026): confirmado que (a) nenhuma fatura ficou com linhas de duas rodadas ao
  mesmo tempo, (b) o total deduplicado (R$248.369,78) ficou correto e DIFERENTE do de
  qualquer rodada individual (R$258.121,80 cada) — não por bug, mas porque o Conexa é um
  sistema vivo e o rateio de algumas faturas mudou entre as duas rodadas (~1h30 de intervalo
  entre elas). Confirmado via curl em todas as granularidades (mês/trimestre/semestre/ano)
  batendo exato com soma direta em SQL.
- Rodada uma verificação adversarial (workflow, 3 revisores independentes + síntese) antes
  de fechar a correção — achou 2 problemas REAIS na v1 do fix, ambos corrigidos antes do
  commit (ver ADR-0012 atualizada): (1) CRÍTICO — a v1 ignorava `revisadoManualmente`, então
  qualquer rodada nova sobreposta (mesmo por motivo não relacionado) revertia silenciosamente
  uma correção manual no Panorama; corrigido priorizando revisão manual no critério de
  desempate. (2) MODERADO — a v1 filtrava por data ANTES de escolher o vencedor por fatura,
  então uma fatura cujo `dataCredito` mudasse entre rodadas podia ser contada em dois
  períodos diferentes ao mesmo tempo; corrigido escolhendo o vencedor GLOBALMENTE, só
  filtrando por data depois. Revalidado contra dado real (marcação manual de teste numa
  linha de uma rodada antiga, confirmando que ela vence sobre a versão nova não-revisada).
- Adicionado também: granularidade "Diário" no Panorama (pedido do usuário, tinha esquecido
  de incluir antes) — `src/lib/dates.ts` ganhou `"day"` no mesmo padrão das demais, 2 testes
  novos.
- **Contexto novo e importante revelado pelo usuário:** a intenção é que este sistema rode
  AUTOMATICAMENTE a cada 15 minutos, mantendo os dados sempre atualizados — não é só um
  botão manual ocasional. Isso muda o cálculo de risco: cada rodada automática cria linhas
  NOVAS (nada é substituído), então rodar para sempre a cada 15 min faria
  `RevenueCategorizedLine` crescer sem limite (na ordem de dezenas de milhares de linhas por
  dia, dependendo do período reprocessado a cada disparo) — a correção desta sessão resolve
  os NÚMEROS exibidos, não esse crescimento de dados. Isso precisa de uma decisão de
  arquitetura (rodadas append-only + faxina periódica das superadas, vs. modelo
  upsert-por-fatura tipo o sync do projeto irmão) antes de construir o agendador — ainda não
  decidido, para discutir com o usuário antes de implementar.

## 2026-07-21 (cont. 4) — Upsert por fatura + sincronização automática de 15 minutos (ADR-0013)
- Levantada com o usuário a decisão de arquitetura em aberto da sessão anterior. Escolhas
  explícitas: (1) modelo de dados — upsert por fatura (não append-only + faxina); (2) janela
  da sincronização automática — mês corrente (dia 1 até agora) a cada execução.
- Schema: `RevenueCategorizationRun` renomeada para `RevenueSyncRun` (deixa de ser dona
  exclusiva das linhas — `onDelete: Cascade` → `ultimaRodadaId`/`onDelete: Restrict`), novo
  enum `OrigemRodada` (MANUAL/AUTOMATICO), contadores `totalLinhasNovas`/
  `totalLinhasAtualizadas`/`totalLinhasOrfasPreservadas`. `RevenueCategorizedLine` ganhou
  `chaveLinha` (identidade estável do bucket, calculada a partir da categoria que a SKILL
  atribuiu — nunca a sobrescrita por revisão manual) e `@@unique([crConexaId, chaveLinha])`.
  Migração `20260721193000_upsert_por_fatura` escrita à mão: renomeia a tabela de rodadas
  preservando dados, faz backfill de `chaveLinha` a partir de
  `COALESCE(categoriaOriginal, categoria)`, deduplica linhas existentes por
  `(crConexaId, chaveLinha)` com a mesma prioridade da ADR-0012 antes de criar a constraint
  única. Aplicada contra o banco de dev local (dado de teste real, sem produção ainda):
  1718 → 886 linhas, 684 faturas distintas (bate com o número já validado em sessões
  anteriores). Confirmado zero drift via `prisma migrate diff` depois de aplicar.
- Novo `src/lib/categorization/persist.ts` (`persistLinhasCategorizadas`) substitui o
  `createMany` por upsert nativo do Prisma por `(crConexaId, chaveLinha)`: protege
  `categoria`/`valorRecebidoCat` de linhas `revisadoManualmente` (passa `undefined` no
  update — Prisma ignora, equivalente a omitir); apaga linhas órfãs (bucket que sumiu do
  resultado da rodada) exceto quando revisadas manualmente, aí preserva e conta.
- `run.ts` reescrito: `startCategorizationRun` recusa rodar (lança
  `SincronizacaoEmAndamentoError`) se já existe uma `RevenueSyncRun` RUNNING — protege tanto
  o agendador colidindo com disparo manual quanto múltiplas réplicas.
- Agendador novo: `src/lib/scheduler/auto-sync-window.ts` (`computeAutoSyncWindow`, puro,
  testado) + `src/lib/scheduler/auto-sync.ts` (tick + loop `setTimeout` auto-reagendado, só
  após o tick anterior terminar) + `src/instrumentation.ts` (hook de boot do Next.js —
  chama `scheduleAutoSync()` uma vez quando o servidor sobe). Novo em `env.ts`:
  `SYNC_AUTO_ENABLED` (default true — cuidado documentado no código: NÃO usar
  `z.coerce.boolean()`, `Boolean("false")` é `true` em JS) e `SYNC_INTERVAL_MINUTES`
  (default 15). Desligado no `.env` local para não logar de verdade no Conexa durante o dev.
- `overview.ts` simplificado: como só existe uma linha por bucket agora, a CTE de
  deduplicação por leitura (`linhasDeduplicadasPorFatura`, SQL cru, ADR-0012) foi removida —
  vira um `findMany` direto filtrado por `dataCredito`.
- `updateCategorizedLineAction` simplificado: não recalcula mais `resumoPorCategoria`/
  `totalRecebido` "da rodada dona da linha" — esse conceito não existe mais (uma linha não
  pertence a uma rodada só). Cada `RevenueSyncRun` guarda só o snapshot congelado do que ELA
  calculou no momento.
- Nova tela `/revisar` (proposta no plano, não pedida explicitamente, mas consequência
  direta da mudança): fila de trabalho GLOBAL e sempre atual de faturas `S`/`SEM_LV`, já que
  com sync a cada 15 min a visão por-rodada (`/runs/[id]`) esvazia com o tempo. Nav
  atualizada. `/runs/[id]` e o export de uma rodada agora mostram o que ela tocou POR ÚLTIMO
  (`ultimaRodadaId`), não mais "tudo que ela processou" como registro fechado.
- Testes novos: `chaveLinha`/`chaveLinhaDoBucket` (mapeada vs. Sem Categoria, incluindo
  SEM_LV e dois serviços não mapeados na mesma fatura) e `computeAutoSyncWindow` (mês
  corrente, virada de mês, virada de ano) — 57 testes passando no total.
- Riscos aceitos, documentados na ADR-0013 (não resolvidos nesta mudança): tombstone de
  fatura cancelada/estornada continua em aberto (mesma limitação da ADR-0012); lock entre
  réplicas é só o guard "já existe RUNNING", não um lock distribuído de verdade; upsert em
  série via Prisma (não SQL em lote), revisitar se o volume crescer muito.

## 2026-07-21 (cont. 5) — Verificação adversarial do upsert por fatura: 10 bugs reais achados e corrigidos
- Dado o risco financeiro da mudança anterior, rodei uma verificação adversarial (workflow:
  3 revisores independentes por ângulos diferentes — concorrência, rigor financeiro,
  migração/agendador — + 1 verificador adversarial por achado, com instrução de tentar
  REFUTAR). De 11 achados levantados, 10 sobreviveram à verificação (só 1 foi refutado).
  Corrigidos todos antes de considerar a mudança pronta:
  1. **CRÍTICO** — `persistLinhasCategorizadas` decidia a proteção de revisão manual (e a
     decisão de apagar linha órfã) a partir de uma leitura separada e não-transacional; uma
     revisão manual feita bem no meio de uma sincronização podia ser silenciosamente
     sobrescrita ou até apagada. Corrigido: função inteira (leitura+delete+upserts) agora roda
     numa única transação Serializable.
  2. **CRÍTICO** — essa correção sozinha não bastava: `updateCategorizedLineAction` também
     precisou virar Serializable (mesmo padrão de `inSerializableGuard`), senão o Postgres não
     tem como detectar o conflito entre os dois lados. Em conflito real (P2034), o admin recebe
     "tente novamente" em vez de a revisão ser aplicada pela metade.
  3. **CRÍTICO** — risco estrutural (não só de timing): uma linha revisada manualmente cujo
     bucket ("Sem Categoria::X") deixa de existir porque "X" ganhou uma regra de verdade depois
     gera um bucket NOVO com a categoria certa, enquanto a linha antiga (preservada, nunca
     apagada) continua ativa — dupla contagem real. Não é auto-corrigível (só um humano decide
     qual versão vale). Mitigado com uma conferência por fatura (soma das linhas vs. valor
     total) que sinaliza via `RevenueSyncRun.totalFaturasComConflito` (nova coluna, migration
     `20260721202400_conflito_faturas_orfas`) e um alerta vermelho em `/runs/[id]` — nunca
     silencioso, mas também não resolvido sozinho.
  4. **CRÍTICO** — `computeAutoSyncWindow()` fusava o horário DUAS vezes no caminho de
     produção (repassava o resultado já-fusado de `nowInAppTz()` para `getPeriodBounds`, que
     fusa de novo) — durante as primeiras ~3h de todo mês (fuso UTC-3), a janela "mês corrente"
     regredia pro mês anterior inteiro. Corrigido; regressão coberta por teste com fake timers.
  5. **CRÍTICO** — `runAutoSyncTick` chamava `computeAutoSyncWindow()` FORA do try/catch — uma
     exceção ali (ex.: por causa do bug acima, ou um fuso malconfigurado) virava unhandled
     rejection e derrubava o processo inteiro, inclusive no tick imediato do boot. Corrigido.
  6. **MODERADO** — `instrumentation.ts::register()` chamava `scheduleAutoSync()` (que valida
     TODO o schema de env, não só variáveis de sync) sem try/catch — uma variável não
     relacionada malconfigurada podia impedir o Next.js de terminar de preparar o servidor,
     derrubando toda requisição. Corrigido com try/catch isolado.
  7. **MODERADO** — o guard "já existe rodada RUNNING" não tinha recuperação: um crash do
     processo no meio de uma rodada a deixava RUNNING para sempre, bloqueando toda
     sincronização futura permanentemente. Corrigido com `RODADA_TRAVADA_MS` (30 min) —
     recupera automaticamente marcando FAILED.
  8. **MODERADO** — delete de linhas órfãs e upserts rodavam em transações separadas (um crash
     no meio deixava estado inconsistente) — resolvido de graça pela correção #1/#2 (tudo numa
     transação só agora).
  9. **MENOR** — financial-rigor.md regra #9(b) ainda descrevia um comportamento
     (recalcular o resumo "da rodada dona da linha") que a própria ADR-0013 já tinha removido
     intencionalmente. Texto corrigido.
- Durante a validação, o usuário perguntou sobre duplicatas visíveis em `/categorias`
  ("Sala 03 da Loja 21", CR 27585, e "Contrato sala 02 - Loja 28", CR 27812, aparecendo 2x) —
  confirmado via SQL direto que o banco atual já tem exatamente 1 linha para cada uma dessas
  faturas; a tela que o usuário via refletia dado de antes da migração/upsert (um dev server
  na porta 3000 já estava rodando fora desta sessão).
- Validação final: `npm run typecheck`/`test`/`build` limpos, migração nova aplicada sem
  drift (`prisma migrate diff` vazio).
