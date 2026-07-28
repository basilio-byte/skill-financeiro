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

## 2026-07-21 (cont. 5) — "Rodadas" → "Sincronizações", skill Impeccable instalado, Confiabilidade da categorização + banner de sincronização ao vivo
- Renomeado o texto visível ao usuário do conceito de rodada de "Rodadas" para
  "Sincronizações" — nav, títulos de página, tabelas em `/runs`, `/runs/[id]`, `/`, `/contas`,
  `/categorias`. Identificadores internos (`RevenueSyncRun`, `OrigemRodada`, ADRs/docs)
  mantidos como estavam — só o nome da página estava em escopo, não um rename de domínio.
- Instalado o skill de terceiros **Impeccable** (`pbakaus/impeccable`, verificado via WebFetch
  antes de instalar — ferramenta real de vocabulário de design para agentes de IA) via
  `npx impeccable install`, em escopo de projeto: `.claude/skills/impeccable` +
  `.github/skills/impeccable`, com hook `PostToolUse` (`.claude/settings.local.json`) rodando
  o detector determinístico após todo Edit/Write em arquivo de UI. Sem `PRODUCT.md` ainda
  (exigiria o fluxo `/impeccable init`, oferecido ao usuário mas não rodado, já que só crítica
  pontual era necessária agora).
- Duas visualizações novas no dashboard, escolhidas depois de mapear as telas do projeto
  irmão `seahub_financeiro` (Explore agent) e descartar o que exige dado que este projeto não
  tem (DRE/despesas/faturamento/recebimentos):
  - **"Confiabilidade da categorização"** no Panorama (`src/components/confidence-breakdown.tsx`):
    barra segmentada + legenda mostrando a composição da receita do período pelo flag
    `Proporcionado` (N/S/SEM_LV) que a skill categoriza-receita já produz mas nunca tinha
    visualização própria. `buildOverview()`/`OverviewData` em `src/lib/reports/overview.ts`
    ganhou `porConfianca`.
  - **Banner "sincronização em andamento"** em `/runs`: indicador pulsante + tempo decorrido +
    auto-refresh a cada 5s (`src/components/auto-refresh.tsx`, `router.refresh()` em loop) —
    justificado pelo scheduler automático de 15 min já em produção (ADR-0013) tornar "tem uma
    sincronização rodando agora?" uma pergunta real.
- Rodei a própria crítica dual-assessment do Impeccable (revisor de design LLM + detector
  determinístico, isolados um do outro via um Workflow) contra as duas adições antes de
  finalizar. Achado real, confirmado calculando luminância à mão: duas das três cores de
  `CONFIANCA` (`emerald-500`/`amber-500`) falhavam contraste não-textual WCAG 1.4.11 (~2.5:1 e
  ~2.1:1) contra o fundo branco do `Card`. Corrigido trocando para os tokens
  `positive`/`warning`/`negative` já existentes (e nunca usados antes) em
  `tailwind.config.ts`, todos ≥5:1 — resolve de graça um segundo achado (`CONFIANCA` era uma
  terceira definição não-referenciada da mesma tríade boa/atenção/ruim). Também corrigidos:
  espessura da barra alinhada ao `h-1.5` do `BreakdownList`; o card de sincronização agora
  linka para `/runs/{id}` (era o único lugar do app referenciando uma rodada sem link);
  `role="status"`/`aria-live="polite"` + `motion-safe:animate-ping` no banner (`Card` em
  `src/components/ui.tsx` passou a aceitar props HTML arbitrárias via spread, antes só
  aceitava `className`/`children`); `NewRunForm` agora se desabilita com aviso quando já há
  sincronização em andamento. Deixado de fora deliberadamente: controle manual de
  pausa/refresh para o poll de 5s (gap real de WCAG 2.2.2, mas decisão de escopo maior para
  uma ferramenta interna de baixo tráfego) — sinalizado ao usuário como follow-up opcional em
  vez de construído sem pedido. Crítica persistida em
  `.impeccable/critique/2026-07-21T21-21-12Z__ma-confidence-breakdown-card-runs-live-sync-banner.md`.
- Validado: `typecheck`/`test` (58/58) limpos, e smoke test manual contra o Postgres de dev
  local real (sessão assinada descartável para o admin já existente, revogada depois) —
  confirmado as duas páginas renderizando com dado real antes e depois da correção de cor
  (863 linhas categorizadas já no banco, composição do período ~45% N / ~48% S / ~7% Sem LV).
- `next lint` não tem config de ESLint nenhuma no repo (gap pré-existente, não desta sessão —
  `next lint` pede setup interativo na primeira vez); não corrigido, fora de escopo.

## 2026-07-22 — Fila de revisão sem linhas zeradas, "Aplicar agora" em /categorias, seletor de categoria, guardas de ADMIN
- **Feedback da Duda (linhas de R$ 0,00):** a fila de `/revisar` mostrava linhas com valor
  zero, que no rateio só registram que a categoria apareceu na fatura e não somam em lugar
  nenhum — revisá-las não muda número nenhum. Filtradas com `valorRecebidoCat: { not: 0 }` na
  listagem E na contagem de pendentes (senão o selo "N pendente(s)" não bateria com a tela),
  nas duas telas que renderizam `LinhaRevisaoRow` (`/revisar` e `/runs/[id]`). Verificado
  contra o Postgres real antes de dar por pronto: 370 → 221 linhas (40% da fila era ruído),
  149 zeradas, 0 negativas, soma confere. Usado `not: 0` e não `gt: 0` de propósito: hoje dá
  no mesmo, mas se um estorno gerar valor negativo, `gt: 0` esconderia justamente a linha que
  mais precisa de olho humano. As zeradas ficam contabilizadas num rodapé, para a lista não
  parecer que perdeu registros. Export `.xlsx` NÃO filtrado — segue sendo o registro completo.
- **Investigação "a Duda clicou em categorizar e nada aconteceu" (ADR-0014).** Diagnóstico
  correu por três hipóteses antes de fechar, e vale registrar o caminho porque duas estavam
  erradas: (1) papel VIEWER — hipótese principal inicial, REFUTADA pelo usuário com print de
  `/contas` mostrando "Administrador"/último acesso; (2) percepção/tempo (a regra funcionou,
  ele só olhou depois do tick automático) — refutada quando o usuário esclareceu que para ele
  o item SAIU da lista e para ela não; (3) a real: a lista de pendências lê outra tabela, e a
  sincronização automática só cobre o mês corrente, então o resultado visível dependia da
  DATA das faturas — coisa que a tela nunca mostrou. Um workflow de 30 agentes rodou em
  paralelo e sua síntese apostou em (1); foi descartada por contradizer o print. Lição:
  evidência do usuário vale mais que consenso de sub-agentes.
- **`/categorias` agora responde ao clique:** `createCategoryRuleAction` virou action com
  estado (confirma o que salvou) e oferece "Aplicar agora", que re-sincroniza o período exato
  das faturas presas em "Sem Categoria". Ver ADR-0014 para o porquê de re-sincronizar em vez
  de dar UPDATE nas linhas (fusão de buckets + rateio).
- **Seletor de categoria (ADR-0015):** `<select>` nativo das categorias existentes +
  "Outra… (digitar)", em `/categorias` (pendências e "Nova categoria") e no campo de categoria
  de `LinhaRevisaoRow`. Fecha a porta para variantes do mesmo nome virarem categorias
  distintas no Panorama.
- **Permissões (ADR-0015):** regras de categoria e disparo de sincronização passam a exigir
  ADMIN (UI e `POST /api/runs`). Novo `checkRole()` para Server Actions — `requireRole()` usa
  `redirect()`, que deixa o formulário mudo; corrigido também nas quatro actions de conta.
- **Validação:** `typecheck` + 58/58 testes limpos, e smoke test contra o dev stack real com
  sessão descartável: `/categorias` renderizou 6 selects (5 pendências + 1 novo) e 102 options
  = 6 × (15 categorias + placeholder + "Outra…"); guarda de permissão testada com um usuário
  VIEWER de verdade → `403 {"error":"Apenas administradores..."}`, sem cookie → bloqueado pelo
  middleware, ADMIN → `201`. **Efeito colateral não intencional:** o teste como ADMIN disparou
  uma sincronização REAL no banco de dev (710 faturas CR, 32 linhas novas, 863 atualizadas) —
  em dev, não em produção, e o upsert preservou revisões manuais, mas o dev ficou mais
  atualizado do que estava. Usuário VIEWER e sessões de teste removidos depois.
- Achado que vale saber: "Cliente Avulso" tem faturas de 2025-08 a 2026-07, então "Aplicar
  agora" nele reprocessaria ~12 meses — por isso a UI avisa quando o período passa de 2 meses.

## 2026-07-22 (cont.) — Metas de receita no Panorama (ADR-0016) + split de grafia documentado (ADR-0017)
- **Feature nova: metas por escopo**, começando por Serviços de Espaço (Seaway/Sebrae/Ayrton
  Senna). Página `/metas` (nova aba no NAV) para configurar meta MENSAL por escopo; card no
  Panorama exibindo meta, realizado, percentual e o que falta, apurado por `dataCredito`.
  Ver ADR-0016 para as decisões (modelo de 3 tabelas, granularidade única, recorte de meta
  parcial, input numérico em vez de parser pt-BR).
- **Decisões de produto tomadas pelo usuário:** escopo = só as categorias "Serviços de
  Espaço - X" (NÃO as "Salas Privativas - X", 4-12x maiores, mesmo eu tendo apontado que
  Ayrton fatura R$ 0,00 e Sebrae só 7% do que a unidade gera); meta mensal com períodos
  maiores somando os meses; percentual da meta cheia + marcador de ritmo linear.
- **Achado que mudou o desenho: split de grafia (ADR-0017).** As regras têm
  "Serviços de Espaço - Sebrae" (UM espaço, porque o seed normaliza o CSV) e as linhas têm
  "Serviços de Espaço -  Sebrae" (DOIS, porque vêm de FIXED_FALLBACKS). Uma meta amarrada a
  uma string nasceria subcontando. Por isso o escopo lista N categorias e cadastra as duas
  grafias. Usuário decidiu não unificar as grafias agora (afeta histórico e as planilhas da
  Duda) — registrado como pendência na ADR-0017.
- **Verificações que mudaram decisão** (não confiar nas propostas sem conferir):
  `getPeriodBounds("quarter", X).fromKey === getPeriodBounds("month", X).fromKey` — um schema
  com (periodoKind, periodoKey) dobraria a meta em silêncio, daí a granularidade única;
  `PeriodKind` tem SEIS valores (inclui "day"), não cinco; um parser pt-BR de moeda converteria
  "25.000" em 25 sem erro, daí `<input type="number">`.
- **CHECK constraints no banco** (não só validação na action): formato de `anoMes`
  (`^\d{4}-(0[1-9]|1[0-2])$`) e valor não-negativo. Testados de verdade contra o Postgres —
  o banco rejeitou "2026-7" e valor negativo.
- **Dois bugs meus que só o smoke test com dado real pegou** (typecheck + 79 testes passavam):
  (1) no modo mensal a tela dizia "Nem todos os 1 meses deste período têm meta definida" —
  a lógica confundia "escopo sem meta" com "mês sem meta"; (2) percentuais renderizavam
  "91.5%" em vez de "91,5%" — criado `formatPercent()` em money.ts, aplicado também no KPI
  "Sem categoria", que tinha o mesmo defeito e ficaria inconsistente na mesma tela.
- **Validação:** typecheck + 79/79 testes (21 novos: 6 de contrato de grafia, 15 de período),
  e smoke test contra o Postgres real com metas de exemplo — Seaway R$ 22.872,23/25.000 =
  91,5%, Sebrae R$ 1.757,27/3.000 = 58,6%, total 88%, Ayrton "sem meta definida", ritmo 70,2%
  no dia 22/07. Conferido também que semana suprime o card e que trimestre exibe o aviso de
  recorte.
- Ficaram no banco de DEV duas metas de exemplo (julho/2026) para inspeção visual. Em
  produção, rodar `npm run db:seed-metas` cria só os escopos; as metas são definidas na tela.
- **Infra:** o Postgres de dev (`skill-financeiro-db-1`) ficou intermitente durante a sessão
  (Supabase subindo em paralelo). Descoberto que o CLI do Prisma falha com P1001 em
  `localhost` mas conecta em `127.0.0.1` — o schema-engine resolve para IPv6. Usar
  `DATABASE_URL` com `127.0.0.1` ao rodar migrations localmente.

## 2026-07-22 (cont. 2) — Seed de metas automático no deploy
- `docker-entrypoint.sh` passa a rodar `scripts/seed-metas.mjs` a cada boot, junto do seed de
  categorias e do bootstrap do admin. Pergunta do usuário ("esse comando não pode ser sempre
  automático no deploy?") — pode, e o projeto já tinha o padrão.
- **Diferença deliberada em relação ao seed de categorias:** aquele só semeia com a tabela
  VAZIA (depois do primeiro boot a tabela é gerenciada por /categorias, e reaplicar o CSV
  sobrescreveria o trabalho da Duda — ADR-0008). O de metas roda SEMPRE, porque aqui o código
  é a fonte de verdade da ESTRUTURA (quais escopos existem e quais categorias cada um soma):
  rodar todo boot faz uma versão nova que acrescente um escopo valer no deploy sem passo
  manual. Valores de meta (MetaPeriodo) nunca são tocados — esses sim vêm da tela /metas.
- Tolerante a falha, mesmo padrão do seed de categorias: `|| echo AVISO` para não derrubar o
  container (subir com o card de Metas vazio é melhor que não subir).
- Não precisou mexer no Dockerfile: `COPY --from=builder /app/scripts ./scripts` (linha 59) já
  leva a pasta inteira.
- **Verificado contra o Postgres real, não só por leitura:** (a) idempotência — 3 execuções
  seguidas, estado idêntico antes e depois (3 escopos, 5 categorias, metas R$ 25.000 e
  R$ 3.000 intactas, 2 eventos de log, sem poluir o log); (b) auto-cura — apaguei uma
  categoria de escopo simulando banco vindo de versão anterior, rodei o seed, ela voltou e as
  metas continuaram preservadas; (c) `sh -n docker-entrypoint.sh` limpo.
- Anotado no cabeçalho do script: se um dia existir tela para renomear escopo, o `update`
  do upsert (que hoje atualiza `nome`/`ordem`) precisa virar `{}`, senão o deploy passa por
  cima da renomeação.

## 2026-07-23 — Porta exata de categoriza_receita.py (ADR-0018)
- Usuário pediu para investigar se o motor de categorização batia EXATAMENTE com a skill
  OpenClaw original. Buscas confirmaram que o `.py` real nunca tinha sido fornecido ao
  projeto — só o `SKILL.md` (texto de orquestração) — e a porta TS de uma sessão anterior foi
  reconstruída a partir de prosa, não de código-fonte. Usuário depois extraiu o `.py` real de
  dentro do container OpenClaw na VPS (`docker cp`) e colou no chat.
- Comparação linha a linha revelou 9 divergências reais (ver ADR-0018 para detalhe completo):
  normalização case-sensitive sem colapso de espaço, sufixo com periodicidade opcional,
  algoritmo de "maior prefixo" reescrito para o loop incremental do Python, join sem
  exclusividade entre faturas concorrentes (usa o grupo inteiro quando o desempate não
  resolve, em vez de cair pra "Sem LV"), tolerância de desempate estrita (`<0,02`), Sem
  Categoria agrupado por fatura (não por serviço), arredondamento por item antes de agrupar
  por bucket, filtro de status do CR por substring, e o achado mais grave — Data Crédito
  incluindo a fatura se QUALQUER data da lista bater no período (não só a primeira).
- **Decisão de produto do usuário, com trade-off explícito:** o novo comportamento de Data
  Crédito significa que a mesma fatura recorrente pode "migrar" de mês conforme sincronizações
  diferentes capturem datas diferentes da sua lista — usuário esclareceu que isso não é um
  risco novo da automação de 15 min, é uma propriedade do próprio script (Duda já teria esse
  mesmo efeito rodando o script duas vezes pra períodos sobrepostos) e pediu para implementar
  exatamente assim mesmo assim.
- Verificação em cada etapa contra dado real (não só fixtures): 102 testes (12 novos), motor
  completo rodado contra o export real do Conexa com as regras de categoria corrigidas —
  conferência fecha exata ao centavo, as 4 faturas parceladas identificadas na sessão anterior
  como "vazadas" de julho agora ancoram certo, e o total recuperado bateu EXATO com a
  estimativa de vazamento de duas sessões atrás (R$10.296,11). Sincronização real ponta a
  ponta via API confirmou: 743 faturas, 0 conflitos, 0 órfãs, conferência = 0.
- **Correção de dado já persistido:** `scripts/fix-categorias-espacamento.mjs` (novo) corrigiu
  74 regras no banco de dev cuja categoria tinha sido colapsada por um bug do seed antigo
  (Ayrton Senna/Sebrae com espaço duplo, mais ~10 nomes de sala com espaço duplo antes do
  hífen) — idempotente, só corrige quando o valor atual bate exatamente com o que o bug
  produziria, nunca sobrescreve possível edição manual. **Pendente rodar contra produção.**
- **Removido** `src/lib/categorization/rateio.ts`/`allocateProportionally` — algoritmo não
  batia com o que o script real faz (resíduo no último bucket agregado, não no último peso);
  ficou sem uso após a reescrita, removido por instrução explícita do usuário.
- **Automatizada** a checagem de qualidade que a skill exige (soma Valor Recebido Cat. = soma
  Valor Recebido do CR) — antes só rodada manualmente num smoke test; agora `run.ts` calcula
  `diferencaConferencia` a cada rodada, grava no `RevenueSyncRun` (migration
  `20260723162405_conferencia_valor_recebido`), loga erro se não fechar, e mostra alerta em
  `/runs/[id]` no mesmo padrão de `totalFaturasComConflito`.

## 2026-07-23 (continuação) — Reconciliação Conexa + auditoria ADR-0019

- **Divergência Conexa "Quitadas" (R$388.368,37) vs nosso Total Recebido (R$279.852,89) para o
  mesmo período/campo (Data Crédito 01/07-23/07) explicada e fechada, sem bug de nosso lado.**
  Fetch direto ao Conexa (mesmas credenciais/filtro do `client.ts`) confirmou: nosso Valor
  Recebido bate EXATO (R$279.852,89) contra o export cru, fatura a fatura; somando Valor Bruto
  no mesmo conjunto dá R$390.172,08 — quase idêntico ao total que o Conexa mostra em "Quitadas"
  (diferença de ~0,5%, explicável pelo instante do print). A tela do Conexa está somando Valor
  Bruto (inflado por contratos anuais/bianuais repetindo o valor total do contrato em cada
  fatura), não Valor Recebido — mesmo artefato já identificado 2 sessões atrás.
- Um teste manual do usuário (soma de coluna no Google Sheets, export "Excel" do próprio Conexa)
  bateu ainda mais baixo (R$107.104,36) — não é outro bug, é o mesmo problema de formato misto na
  coluna Valor Recebido (`parseMoneyCell` já documenta isso: número solto abaixo de R$1.000, texto
  BR completo acima) enganando a soma automática do Sheets, que trata parte das células como
  texto e as exclui silenciosamente (confirmado pelo próprio usuário via `COUNT` < `COUNTA`).
- **Achado à parte (fora da auditoria formal):** o botão "Baixar planilha" em `/runs/[id]` vinha
  vazio para qualquer rodada que não fosse a mais recente — a query filtrava por
  `ultimaRodadaId`, que o auto-sync de 15 min recarimba em todas as linhas a cada tick. Corrigido
  para filtrar por `dataCredito` no período da própria rodada.
- **Auditoria multi-agente (ADR-0019):** a pedido do usuário ("estude a fundo... corrija...
  sistema estável e confiável"), workflow de 6 agentes releu o `.py` real inteiro contra cada
  fatia do port TS + a arquitetura de sync/persist, com verificação adversarial (agente instruído
  a REFUTAR, não confirmar) de cada achado antes de corrigir. 12 candidatos → 10 confirmados, 2
  refutados. Corrigidos nesta sessão: `normalizeRuleName` colapsando espaço duplo (mesma classe
  de bug do ADR-0017, numa função que tinha ficado de fora), dedup indevido de nomes de serviço
  repetidos no bucket, `parseFlexibleDate` sem cortar por vírgula (Competência/Ref. Cobrança) e
  exigindo 2 dígitos de dia/mês, timeout ausente nos fetches ao Conexa, falta de recheck do
  status da rodada antes de persistir (risco de duas rodadas concorrentes escreverem o mesmo
  período), e P2034 sem retry no lado do sync (colisão com revisão manual marcava a rodada
  inteira como FAILED à toa). **3 achados envolviam trade-off de produto** (não bugs puros) e
  foram apresentados ao usuário com o risco explícito de cada lado: Data Crédito com hora
  anexada (Python exclui a fatura, TS incluía), arredondamento em empates exatos (HALF_UP decimal
  exato vs round() do Python sobre float impreciso), e join com Cliente ID nulo (Python permite
  colisão via `None`, TS bloqueava). **Usuário escolheu fidelidade total ao Python nos três**,
  consistente com a diretriz já dada no ADR-0018 — implementado em seguida: `parseFlexibleDate`
  agora rejeita data com hora anexada (regex ancorado, sem strip de hora); nova `roundMoneyRateio`
  (HALF_EVEN, money.ts) usada só no rateio proporcional (categorize-invoices.ts), sem tocar o
  `roundMoney` genérico; join.ts removeu as duas guardas de `clienteId === null`, deixando a
  chave-string colidir em "null" igual ao dict do Python. Validado: typecheck limpo, 105 testes
  (6 novos), e o pipeline real rodado de novo contra o export ao vivo do Conexa — mesmo resultado
  de antes de qualquer correção (758 faturas, R$279.852,89) em duas rodadas de verificação,
  confirmando ausência de regressão mesmo após a mudança de fidelidade de Data Crédito.
- **Nova divergência investigada (2026-07-24):** usuário reportou planilha baixada do Conexa
  (Contas a Receber, sem filtro) somando R$282.946,43 de Valor Recebido, contra R$290.323,15 no
  Panorama pro mesmo mês. Aplicando o filtro exato do nosso motor (status aceito + Data Crédito,
  "qualquer data da lista") na própria planilha do usuário deu o mesmo valor dela — não é bug de
  filtro. Um fetch novo direto no Conexa, feito na hora, mostrou crescimento normal (~R$1.560 em
  algumas horas, atividade real do dia) mas ainda deixou ~R$5.816,85 sem explicação. Causa
  identificada: a própria tela de `/runs/[id]` já mostrava "12 fatura(s) com possível dupla
  contagem" (mecanismo documentado na ADR-0013 — linha revisada manualmente preservada + bucket
  novo criado depois que uma regra de verdade passou a existir, contando o mesmo dinheiro duas
  vezes), usuário confirmou que o alerta persiste. **Não corrigido ainda** — requer decisão
  humana por fatura (qual linha é a certa), não dá pra automatizar às cegas. Criado
  `scripts/diagnostico-conflitos.mjs` (só leitura, não corrige nada) que lista, fatura por
  fatura, o valor real, a soma atual das linhas, e o detalhe de cada linha (categoria/valor,
  se foi revisada manualmente, por quem/quando, e o que a skill tinha calculado antes da
  revisão) — para rodar em produção via Console do Easypanel e decidir caso a caso.

- **Tela `/conflitos` + resolução automática dos padrões conhecidos (2026-07-24).** Rodado
  `diagnostico-conflitos.mjs` em produção: as 12 faturas se encaixam em exatamente 2 padrões,
  ambos com regra segura e determinística (nenhum caso ambíguo entre as 12):
  - **`duplicata_sem_categoria`** (4 casos, ex. CR 15476): a fatura tem plano genérico ("Cliente
    Avulso"), que o motor nunca vai conseguir categorizar sozinho (cai em "Sem Categoria" toda
    rodada); a linha manual tem a categoria real que alguém identificou olhando a fatura. Excluir
    só a automática NÃO basta — o motor recria em até 15 min, já que continua gerando "Sem
    Categoria" pra esse plano. Resolução: apaga a automática E re-chaveia a manual para a MESMA
    chave que o motor produz agora (`chaveLinha = "Sem Categoria"`) — dali em diante, o upsert da
    sincronização encontra essa linha (não cria uma nova) e a protege por `revisadoManualmente`,
    sem nunca mais duplicar.
  - **`manual_superada`** (8 casos, ex. CR 26553): uma `RevenueCategoryRule` real passou a existir
    depois da revisão manual (via nome do item no Listar Vendas), e o motor já categoriza sozinho
    na MESMA categoria que a revisão manual já dizia. A linha manual (chave antiga, do esquema
    pré-ADR-0018 — `"Sem Categoria::Cliente Avulso"`, que o motor não gera mais) é redundante.
    Resolução: só apaga a linha manual; nunca é recriada.
  - Excesso total das 12 faturas: R$2.445,52 — explica a maior parte do resíduo de ~R$5.816,85
    encontrado na investigação anterior (o resto é atividade normal do dia, dinheiro chegando
    entre uma sincronização e outra).
  - **Construído:** `src/lib/categorization/classificar-conflito.ts` (função pura,
    `classificarConflito`, testável sem banco — 6 testes cobrindo os 2 padrões + 4 formatos
    ambíguos que devem ficar de fora), `src/lib/categorization/conflitos.ts` (`listarConflitos`,
    server-only, agrega linhas por fatura e aplica a classificação), `conflitos-actions.ts`
    (`resolverAutomaticamenteAction` — reclassifica com dado FRESCO dentro da própria transação
    Serializable antes de agir, nunca confia na classificação já renderizada; `excluirLinhaConflitoAction`
    — exclusão manual genérica pros casos ambíguos, ADMIN-only). Nova página `/conflitos` (nav
    item ADMIN-only) lista todas as faturas em conflito com o detalhe de cada linha e um botão
    "Resolver automaticamente" quando o padrão é reconhecido, ou "Excluir esta linha" com
    confirmação quando é ambíguo. `scripts/resolver-conflitos.mjs` (novo) aplica a MESMA lógica
    direto em produção via Easypanel, sem precisar abrir a tela — a lógica de classificação está
    duplicada em JS puro ali (mesmo motivo de `fix-categorias-espacamento.mjs`: scripts standalone
    não passam pelo bundler/alias do Next), com o comentário deixando explícito que as duas cópias
    precisam ficar em sincronia. Validado: typecheck limpo, 111 testes (6 novos). Smoke test de
    navegador NÃO foi feito nesta sessão (sem stack de dev local rodando) — recomendação: testar
    contra dado real assim que possível.
  - **Confirmado no dia seguinte:** usuário resolveu as 12 faturas pela tela `/conflitos`. `"Sem
    Categoria no período"` caiu de R$1.097,92 para R$0,00 — bate EXATO com a soma das 4 faturas do
    padrão `duplicata_sem_categoria` (933,42+64,50+75,00+25,00), confirmando que a resolução
    funcionou como esperado. Usuário então perguntou por que o Total Recebido do Panorama não
    bate com o total que a própria sincronização reporta, mesmo com 0 conflitos — resposta: são
    consultas estruturalmente diferentes (`RevenueSyncRun.totalRecebido` é uma FOTO do que o
    motor calculou naquele instante, sem nunca refletir revisão manual; o Panorama soma o estado
    ATUAL persistido, que inclui revisões de propósito). Para nunca deixar "diferença sem
    explicação" de novo, criado `scripts/conferencia-completa.mjs`: busca o export real do Conexa
    agora, soma com o filtro exato do motor (verdade), compara com a soma atual do banco (o que o
    Panorama mostra) e com "o que a skill diria sem revisão manual" (banco trocando o valor de
    toda linha `revisadoManualmente` pelo `valorRecebidoCatOriginal`) — reporta as duas diferenças
    separadamente (motor vs Conexa; revisão manual vs skill) e LISTA cada revisão manual que
    contribui pro segundo número (fatura, categoria antes/depois, valor antes/depois, quem,
    quando), pra nunca sobrar resíduo sem dono. Testado o lado do fetch/parse do Conexa (roda e
    filtra certo); o lado do banco não pôde ser testado localmente (sem Postgres de dev rodando
    nesta sessão) — falha de conexão esperada e clara (`Can't reach database server`), não uma
    resposta errada silenciosa.
  - **Bug encontrado ao rodar em produção:** o script tentava ler um arquivo `.env` do disco
    (`loadEnv(".env")`, copiado sem ajuste do padrão usado nos testes locais desta sessão) — mas
    em produção as credenciais do Conexa vêm injetadas direto no ambiente pelo Easypanel
    (Secrets), sem arquivo `.env` no container. Corrigido para usar `process.env` diretamente
    (igual a `conexa-web/client.ts`), com erro claro se alguma variável estiver ausente.
    Confirmado que os outros dois scripts (`diagnostico-conflitos.mjs`, `resolver-conflitos.mjs`)
    não tinham esse problema — só usam Prisma, que já lê `DATABASE_URL` do ambiente sozinho.
  - **Rodado em produção:** conferência (2) e (3) batem entre si (R$291.450,05, 0 revisão manual
    com valor alterado neste período) — descarta revisão manual como causa. Mas (3) vs (1) (banco
    vs Conexa fresco) diverge em **R$5.229,40** — banco tem mais dinheiro do que o Conexa aceita
    agora pro mesmo filtro. **Hipótese levantada, ainda não confirmada com dado real:**
    `persistLinhasCategorizadas` só reavalia "esta linha ainda deveria existir?" para faturas que
    aparecem no resultado da sincronização ATUAL — uma fatura aceita e persistida numa rodada
    antiga, que depois SOME inteira do resultado de rodadas seguintes (status mudou pra algo não
    aceito, ou a Data Crédito foi corrigida/mudou de mês no Conexa), nunca é reavaliada: sua linha
    fica no banco pra sempre. Diferente de "órfã" (já tratado) — órfã é quando a fatura CONTINUA
    aparecendo mas muda de bucket; este caso é a fatura sumir do resultado por completo, sem
    nenhum tombstone (risco já flagado, sem solução, desde a ADR-0012: "no tombstone mechanism
    for cancelled/reversed invoices"). Usuário perguntou se não seria mais simples apagar tudo e
    resincronizar do zero — recomendei NÃO fazer isso: (a) apagaria revisões manuais com valor
    igual ao calculado pela skill mas categoria diferente, que a conferência de hoje não detecta
    (só compara valor, não categoria) e por isso não temos certeza de que não existem; (b) resolve
    o sintoma, não a causa raiz — a mesma sujeira voltaria a se acumular com o tempo. Criado
    `scripts/diagnostico-residuo-motor.mjs` (só leitura) para confirmar a hipótese com dado real
    antes de qualquer correção: busca o export fresco do Conexa e compara fatura por fatura
    (`crConexaId`) contra o banco, listando quem está de um lado e não do outro. Testada a parte
    do Conexa localmente (782 faturas, bate com o resultado do usuário); parte do banco não
    testável aqui (sem Postgres de dev). **Pendente:** rodar em produção e, com o resultado,
    decidir a correção exata em `persist.ts` (ampliar a query de `existentes` pra incluir
    qualquer linha com `dataCredito` dentro do período da rodada, não só as faturas que aparecem
    no resultado atual) e a limpeza cirúrgica das linhas confirmadas como obsoletas.
  - **Confirmado e corrigido (ADR-0020).** Rodado em produção: 28 faturas (R$6.029,12, quase
    todas "Endereço Fiscal") persistidas no banco mas que o Conexa não aceita mais pro período —
    confirma a hipótese. `persistLinhasCategorizadas` (persist.ts) ganhou os parâmetros
    `periodoInicio`/`periodoFim`; a busca de `existentes` agora inclui `dataCredito` dentro do
    período da própria rodada, não só `crConexaId` das faturas que ainda aparecem no resultado —
    o resto da lógica de órfã (preservar se revisada manualmente, apagar senão) já cobria esse
    caso corretamente, só faltava a query trazer essas linhas pro laço. Autocorretivo: a partir
    do próximo tick do auto-sync, as 28 linhas (nenhuma revisada manualmente) são apagadas
    sozinhas — nenhum script de limpeza pontual necessário. Usuário sugeriu apagar todo o
    histórico e resincronizar do zero; recomendado não fazer isso (perderia revisão manual com
    categoria diferente mas valor igual, que a conferência não detecta; e só resolveria o
    sintoma, não a causa). Validado: typecheck limpo, 111 testes (sem teste dedicado — persist.ts
    é server-only/Prisma, mesmo padrão do resto do arquivo). **Pendente:** confirmar pós-deploy
    rodando `diagnostico-residuo-motor.mjs` de novo depois do próximo tick do auto-sync.
  - **Inesperado pós-deploy:** usuário confirmou 3 rodadas automáticas "Concluída" após o deploy
    do fix, cada uma já calculando certo (782 faturas, R$286.220,65 — bate exato com o Conexa
    fresco), mas rodando `diagnostico-residuo-motor.mjs` de novo mostrou as MESMAS 28 faturas,
    valores e categorias idênticos byte a byte — ou seja, a rodada em si está correta, mas a
    limpeza das linhas obsoletas não está acontecendo. Criado `scripts/inspecionar-linha.mjs`
    (só leitura) para olhar os campos exatos (dataCredito, revisadoManualmente, ultimaRodadaId,
    atualizadoEm) de faturas específicas e descobrir se a causa é a query não pegar essas linhas,
    ou pegar e mesmo assim não apagar. **Investigação em andamento, sem conclusão ainda.**
  - **Achado real (revisão da hipótese):** as 4 faturas inspecionadas têm `dataCredito` no
    FUTURO (27, 28, 29/07 — hoje é 24/07), todas tocadas pela mesma `ultimaRodadaId`
    (`cmrxr1cqb01d0og01yr81qwan`, iniciada 2026-07-23T16:52). Isso **não é** o bug do tombstone
    corrigido na ADR-0020 (aquela correção está certa) — é outra coisa: o auto-sync nunca pede
    período além de "agora", então uma rodada com `dataCredito` persistido no futuro só pode vir
    de uma sincronização manual/validação que usou um período estendido além de hoje. Faturas
    recorrentes (ex. "Endereço Fiscal", maioria dos 28) têm LISTA de datas de crédito, e a regra
    "qualquer data da lista que bater no período" (fidelidade total ao Python, ADR-0018/0019)
    pegou uma data futura agendada, ainda não realizada, como se já tivesse sido recebida.
    Atualizado `scripts/inspecionar-linha.mjs` pra também mostrar origem/período exato da
    `ultimaRodada`, pra confirmar a hipótese antes de decidir a correção. **Confirmado**: origem
    MANUAL, período 28/06 a 31/07/2026, rodada de 23/07 (quando "hoje" ainda era 23/07 — 31/07
    já era 8 dias no futuro).
  - **Corrigido (ADR-0021).** "Data Crédito" representa dinheiro JÁ creditado — `run.ts` agora
    calcula `periodoFimEfetivo = min(params.periodoFim, nowInAppTz())` e usa esse valor (não o
    período pedido direto) como limite pra decidir se uma data "está no período" — nunca mais
    aceita uma Data Crédito além de hoje de verdade, nem em sincronização manual/API mal
    configurada. O fetch ao Conexa continua usando o período original (inofensivo buscar mais
    largo; só a aceitação da data é limitada). Criado `scripts/limpar-datacredito-futuro.mjs`
    (idempotente) pra apagar o que já ficou persistido errado antes desta correção — preserva e
    reporta qualquer linha revisada manualmente (não deveria acontecer, mas checado por
    segurança). Quando a data real chegar, a sincronização automática recria a fatura
    corretamente, se ainda válida. Validado: typecheck limpo, 111 testes.

## 2026-07-24 (continuação) — Metas: escopo unificado + trimestral (ADR-0022)

- **Alinhado com a Duda:** os 3 escopos de meta por unidade (Seaway/Sebrae/Ayrton Senna) viram
  UM só ("Serviços de Espaço", somando as 3), e a granularidade muda de mensal para trimestral.
  Migration `20260725000000_metas_trimestrais` renomeia `MetaPeriodo.anoMes` → `anoTrimestre`
  ("yyyy-Q#"), com `DELETE FROM meta_periodos` explícito antes (nenhuma meta real existia em
  produção; não há conversão sensata de valor mensal pra trimestral) e remove os 3 `MetaEscopo`
  antigos (protegido por `ON DELETE RESTRICT` — falharia alto se alguma meta real ainda os
  referenciasse). `periodo.ts`, `metas.ts`, `actions.ts`, `metas-form.tsx`, `metas-panel.tsx` e
  `metas/page.tsx` atualizados; `periodoAceitaMeta` agora exclui mês também (só
  quarter/semester/year aceitam meta). Formulário trocou `<input type="month">` por dois
  `<select>` (Ano + Trimestre).
- **Validado de ponta a ponta contra Postgres real** (não só typecheck/testes): migration
  aplicada com sucesso no dev DB; seed rodado 2x (idempotente); `buildMetas` chamado direto
  contra dado real (Seaway R$30.561,99 + Sebrae R$3.643,89 + Ayrton R$0,00) com uma meta de teste
  — resultado bateu exato (R$34.205,88, 34,2%); confirmado `month` agora retorna
  `aplicavel: false` (antes `true`). Smoke test de navegador real via sessão JWT criada à mão
  (mesmo mecanismo de `createSession`) — `/metas` e `/` renderizados autenticados, card único
  "Serviços de Espaço" confirmado no Panorama com o valor agregado certo. Ambiente de teste
  limpo ao final (meta de teste, sessão, dev DB parado).
- Typecheck limpo, 114 testes (3 novos em `periodo.test.ts`, `escopos.test.ts` reescrito pro
  escopo único).
- **Seletor de Ano em `/metas` era uma janela fixa `[hoje-1, hoje, hoje+1]`** — usuário notou que
  não dava pra navegar além de 2027 e pediu algo durável ("vamos usar esse sistema por anos").
  Trocado por setas ‹/› (mesmo padrão do `PeriodControls` do Panorama) que deslizam a janela de
  3 anos CENTRADA no ano visto agora, não no ano real — sem limite de navegação em nenhuma
  direção, e sem precisar de código novo daqui a 5 ou 50 anos. Link "Ano atual" aparece só quando
  o ano visto diverge do real.

## 2026-07-27 — Integração ClickUp: espelhar receita nos campos de mês de "Eficiência" (ADR-0023)

- **Pedido do usuário:** alimentar os campos Currency (Janeiro..Dezembro) das tarefas do ClickUp
  a partir do skill-financeiro, a cada sincronização (não só no fechamento do mês).
- **Exploração real da API do ClickUp antes de desenhar o modelo** (token do usuário, lista
  "Eficiência" id `901326339447`): confirmado que os 29 campos customizados são compartilhados
  por TODAS as 100 tarefas (schema de lista, não por tarefa) — a preocupação do usuário de que
  tarefas diferentes pudessem ter campos diferentes não se confirmou, o que varia é só quais
  campos vêm preenchidos. Achado real que mudou o design do matching: o campo de novembro está
  gravado como **"Novembo"** (typo, sem o R) — `resolverCamposPorMes` (mes-fields.ts) casa contra
  uma lista explícita de variantes exatas por mês (sem acento/caixa), então o typo não quebra nada
  (testado em `mes-fields.test.ts`). Versão inicial casava por PREFIXO de 3 letras em vez disso;
  trocada depois que a revisão adversarial (ver abaixo) achou colisão real com nomes de campo não
  relacionados.
- **Achado que reduziu o escopo do v1:** as 100 tarefas misturam categorias por CLIENTE (ex.
  Endereço Fiscal — casa direto com `categoria + clienteConexaId`) e por SALA/espaço físico (ex.
  "Sala 05 - Loja 30" — sem chave equivalente no schema hoje, o inquilino pode trocar). Perguntado
  ao usuário: v1 cobre só categorias por cliente; Salas Privativas/Serviços de Espaço ficam de
  fora até existir uma chave por sala — sem código forçando isso, é só o admin não cadastrar
  vínculo pra essas categorias.
- **Implementado:** migration `20260727000000_clickup_integracao`
  (`ClickUpVinculo`/`ClickUpListaCache`/`ClickUpPushLog`); `src/lib/clickup/{mes-fields,client,
  decisao-push,push,clientes,actions}.ts`; hook em `run.ts` logo após persistir com sucesso,
  isolado em try/catch próprio (falha do ClickUp nunca marca a rodada como FAILED); tela admin
  `/integracoes/clickup` (ADMIN-only, `requireRole`) com cadastro de vínculo (categoria via
  `CategoriaField` reaproveitado, cliente via `<datalist>` de apoio buscando por razão
  social/CNPJ e resolvendo pro `clienteConexaId` numérico) e botão "Empurrar agora" (força o
  envio, ignora a checagem de "valor mudou?" — serve pra testar sem esperar a próxima rodada).
  Corpo do POST de campo Currency (`{ "value": <number> }`) confirmado direto na documentação
  oficial do ClickUp, sem precisar de uma escrita de teste real pra descobrir o formato.
- **Validado (1ª rodada):** liberado o `next dev` que travava o `.dll` do Prisma Client;
  `prisma generate`, typecheck e 123 testes passaram limpos. Smoke tests reais contra o dev DB
  (sem tocar a API do ClickUp — `CLICKUP_API_TOKEN` propositalmente não configurado, pedido
  explícito do usuário): `pushValoresDoMesCorrente()`/`pushVinculoAgora()` saem cedo sem log nem
  rede; `/integracoes/clickup` renderiza certo autenticado (vínculo de teste, categorias, cliente
  via datalist) e redireciona não-autenticado pra `/login`; `/` e `/runs` sem regressão.
- **Revisão adversarial multi-agente (4 dimensões: isolamento, dinheiro/precisão, segurança,
  matching/schema — 34 sub-agentes, ~1,58M tokens) rodada antes do commit — 10 achados
  confirmados, 2 CRÍTICOS:**
  1. **Fuso duplo em `periodoCorrente()`** (mesmo bug já corrigido em `auto-sync-window.ts`,
     reintroduzido aqui): nas primeiras ~3h de todo mês, a receita do mês ANTERIOR era escrita no
     campo do mês novo do ClickUp, com `sucesso: true` no log — nenhum teste cobria isso. Extraído
     pra `src/lib/clickup/periodo-corrente.ts` (puro) com teste de regressão dedicado (fake timers
     no exato instante do achado).
  2. **Matching por prefixo de 3 letras colidia com nomes de campo reais** ("Novidades",
     "Setor Comercial", "Margem de Lucro" batiam em novembro/setembro/março só pelo prefixo) —
     trocado por lista explícita de variantes EXATAS por mês.
  3. CHECK `valorEnviado >= 0` na migration impedia logar (e mascarava, via `.catch(()=>{})`) um
     push de valor negativo (estorno/reembolso do cliente no mês) — removida da migration.
  4. Cache de campo nunca se autocurava apesar do comentário do schema prometer isso — trocado
     por autocura real (`escreverComAutoCura`: se a escrita falhar, atualiza o cache e tenta de
     novo uma vez).
  5. `res.json()` explodia em corpo vazio (204/200 sem corpo) mesmo com o campo já escrito com
     sucesso — `api()` agora trata corpo vazio como sucesso sem dado.
  6. Mês sem campo correspondente na lista martelava a rede a cada push — cache negativo por
     `CACHE_MAX_AGE_MS` (1h).
  7. Path traversal via `clickUpListId`/`clickUpTaskId` sem validação de formato, redirecionando
     a chamada HTTP pra outro endpoint da mesma API — validado em duas camadas (zod na action +
     de novo em `client.ts`).
  8. Vínculo criado sem nenhuma linha histórica correspondente empurraria R$ 0,00 silencioso todo
     mês — `criarVinculoAction` agora avisa (não bloqueia).
  9. (Aceito, não corrigido) push sequencial pode esticar o ciclo de sync se o ClickUp ficar
     lento — risco documentado na ADR-0023, não construída mitigação extra pro volume do v1.
  10. (Aceito, não corrigido) `categoria` é texto livre sem enumeração de variantes — drift de
      grafia POSTERIOR à criação do vínculo não é coberto pelo aviso do item 8; risco documentado.
- **Re-validado após os fixes:** typecheck limpo, 128 testes (5 novos: 2 em `mes-fields.test.ts`
  travando a rejeição de falso-positivo, 3 em `periodo-corrente.test.ts` travando o fuso), smoke
  tests re-executados contra o código real pós-fix (mesmo critério: zero chamada de rede ao
  ClickUp). Detalhes completos de cada achado na ADR-0023 (decisions.md). Nada commitado ainda —
  push real de teste contra a API do ClickUp segue pendente até o primeiro vínculo real ser
  cadastrado.
- **Correção de premissa (ADR-0024) — usuário apontou o erro:** "Endereço Fiscal Batial" não é 1
  cliente, é a SOMA de todos os clientes que usam aquele produto ("Alguns serviços são por
  clientes, outros não. Outros é a soma de todos."). Pedido: "quero que analise tudo". Investigação
  real (API do ClickUp de novo, TODAS as 100 tarefas desta vez, não só 3 amostras + query direta no
  dev DB): confirmado que as tarefas "Endereço Fiscal *" têm os campos de relacionamento
  `Clientes`/`LOCATÁRIO` vazios (nenhum cliente específico ligado), e que TODA categoria do sistema
  tem dezenas a centenas de clientes distintos (Endereço Fiscal: 555 linhas/519 clientes; Serviços
  de Espaço - Seaway Center: 163/133; SeaBox: 14/11) — não existe categoria "de 1 cliente só". O
  que distingue "Batial" de "Litoral" é um substring dentro do texto livre de `servicoOuPlano`
  (Serviço/Plano da fatura no Conexa), e o MESMO mecanismo cobre salas físicas (padrão = nome da
  sala) — elimina de vez a divisão "cliente vs. sala" inventada na ADR-0023.
- **Redesenhado:** `ClickUpVinculo.clienteConexaId`/`razaoSocialCache` removidos; `padroes` (Json
  `string[]`) no lugar. `src/lib/clickup/filtro-padroes.ts` (puro, testado) monta o filtro
  categoria + OR de `contains` case-insensitive por padrão, reaproveitado por `push.ts` e pela nova
  ação `previsualizarVinculoAction`. Tela admin ganhou botão "Pré-visualizar" — mostra, ANTES de
  salvar, quais `servicoOuPlano` reais batem (ocorrências, clientes distintos) e o total do mês
  corrente exato que seria empurrado; "Vincular" só depois de conferir. `clientes.ts` (busca de
  cliente) apagado, não faz mais sentido.
- **Validado com dado real:** `filtroPorPadroes("Endereço Fiscal", ["Batial"])` contra o dev DB
  achou 75 linhas / **65 clientes distintos** / R$ 12.323,25 — confirma o comportamento pretendido.
  Isolamento (push sem token, sem log, sem rede) re-testado com o novo schema, continua correto.
  Typecheck limpo, 135 testes (7 novos em `filtro-padroes.test.ts`). Detalhes na ADR-0024
  (decisions.md). Commitado e enviado (8575c1b).
- **Bug real reportado pelo usuário logo após usar a tela:** "Pré-visualizar" e "Vincular"
  dividiam o mesmo `<form>` (action padrão + `formAction`) — o React reseta os campos não
  controlados assim que a ação do clique termina, então clicar em "Pré-visualizar" limpava
  categoria/lista/tarefa/padrões antes de "Vincular" poder usar os mesmos valores. Corrigido em
  `clickup-vinculo-form.tsx`: "Pré-visualizar" virou um botão comum (`type="button"`) que lê o
  `FormData` via `ref` e chama `previsualizarVinculoAction` direto (fora do mecanismo de
  `<form>`/`formAction`), sem resetar nada. Validado com `next build` (compila, type-checa e
  linta a produção inteira) + suite completa (135 testes) — sem acesso a navegador real neste
  ambiente pra clicar de fato, então a verificação ficou no nível de build/lint/testes, não de
  clique-a-clique.

## 2026-07-27 (continuação) — Metas: seletor de Ano do formulário ainda tinha teto fixo

- **Usuário reportou (print de `/metas?ano=2028`):** o formulário "Definir meta" mostrava só
  2025/2026/2027 no seletor de Ano, mesmo navegando pela tela pra 2028 — apesar da navegação por
  setas (já corrigida antes) ser ilimitada. Causa: `anoTrimestrePadrao` (passado pro formulário)
  vinha de `trimestreDaData(agora)` — sempre o ANO REAL de hoje, nunca o ano que a página estava
  de fato exibindo (`?ano=` na URL). O formulário e a navegação eram duas fontes de "ano" agindo
  de forma independente.
- **Corrigido em `metas/page.tsx`:** o padrão do formulário agora deriva do `ano` visto na URL
  (mesma variável que já alimenta a navegação), não de `agora`. O trimestre-padrão só usa o
  trimestre real quando `ano === anoCorrente`; pra qualquer outro ano (sem "trimestre atual" que
  faça sentido) cai em Q1. Validado contra o dev server real: `/metas?ano=2028` agora mostra
  2027/2028/2029 no seletor; `/metas` (sem parâmetro, ano real) continua mostrando 2025/2026/2027
  como antes — sem regressão no caminho comum.

## 2026-07-27 (continuação) — ClickUp: matching de padrão precisa ignorar acento (ADR-0024)

- **Usuário reportou:** categoria de Endereço Fiscal tem duas grafias reais convivendo
  ("Comercio" e "Comércio") e não conseguiu cobrir as duas com um padrão só. Confirmado no dev DB:
  5 linhas reais da categoria "Endereço Fiscal" com essa variação exata (3 com acento — SEAHUB
  COWORKING —, 2 sem — SEATECH). O filtro `contains`/`mode: "insensitive"` do Postgres só ignora
  maiúscula/minúscula, nunca acento.
- **Corrigido:** casamento saiu da query do Postgres e passou pra JS. Novo `bateAlgumPadrao`
  (`filtro-padroes.ts`, puro) substitui o antigo `filtroPorPadroes` (que montava `where` do
  Prisma); usa `normalizarTexto` — extraído para `src/lib/text-normalize.ts` a partir do mesmo
  algoritmo (NFD + descarta diacrítico + lowercase) que já existia isolado dentro de
  `mes-fields.ts` pro nome dos campos do ClickUp, agora compartilhado. `push.ts`/`actions.ts`
  buscam só por `categoria` (+`dataCredito` quando cabe) e filtram por padrão em memória —
  categoria isolada não passa de umas poucas centenas de linhas, custo desprezível.
- **Validado contra dado real:** um único padrão "Comércio" (ou "Comercio") agora bate nas 5
  linhas reais nos dois sentidos, somando R$ 3.099,60. Typecheck limpo, 142 testes (novo
  `text-normalize.test.ts` + 6 novos em `filtro-padroes.test.ts`).

## 2026-07-27 (continuação) — ClickUp: excluir vínculo + confirmar push automático

- **Usuário já com vínculos reais funcionando em produção** (print de `/integracoes/clickup` com
  4 vínculos de Endereço Fiscal e pushes bem-sucedidos) pediu: (1) opção de apagar um vínculo
  (só existia ativar/desativar) e (2) "verifique e assegure" que o push acontece em toda
  sincronização automática, não só quando alguém clica "Empurrar agora".
- **Excluir vínculo:** `excluirVinculoAction` + `ExcluirVinculoButton`, mesmo padrão de
  confirmação inline de dois cliques já usado em `/conflitos` (nunca `window.confirm()` nativo).
  Cascade apaga só `ClickUpPushLog`; `RevenueCategorizedLine` nunca é tocada — confirmado contra
  o dev DB real.
- **Push automático confirmado por leitura direta do código:** `run.ts` chama
  `pushValoresDoMesCorrente()` incondicionalmente após qualquer rodada bem-sucedida, sem
  ramificar por `origem` — automática e manual passam pelo mesmo caminho. Os horários no print do
  usuário eram de cliques manuais em "Empurrar agora" (testa 1 vínculo isolado, sem sincronizar),
  não de ticks automáticos.
- **Visibilidade adicionada:** `pushValoresDoMesCorrente()` agora devolve um resumo
  (`vinculosAtivos`/`atualizados`/`semMudanca`/`falharam`) e `run.ts` loga isso a cada rodada —
  dá pra confirmar nos logs do Easypanel, sem precisar de acesso ao banco, que o push roda a cada
  ciclo de 15 min. Explicado ao usuário: `devePush` pula o reenvio quando o valor não mudou desde
  o último sucesso — não ver "Último envio" atualizar depois de 15 min é esperado se a receita
  daquele produto não mudou, não é sinal de que o mecanismo parou de funcionar.
- Typecheck limpo, 142 testes, exclusão e resumo validados contra o dev DB real. Nada commitado
  ainda.

## 2026-07-28 — ClickUp: vínculos de Salas Privativas (3 unidades) + 2 bugs achados na tentativa

- **Usuário pediu:** criar os vínculos de Salas Privativas (Ayrton Senna, Sebrae, Seaway Center) e
  perguntou o que mais estava pendente na integração.
- **Investigação real antes de criar qualquer coisa** achou 2 bugs que precisavam de correção
  primeiro: (1) espaçamento repetido no `servicoOuPlano` real ("Sala 08 - Loja 24" com 1, 2 ou 3
  espaços) quebrava o casamento por substring — corrigido colapsando espaço em `normalizarTexto`;
  (2) faturas que combinam várias salas numa linha só (uma delas: Sebrae "Sala 08+09+10" =
  R$8.200 numa linha) fariam DOIS vínculos (um por sala) dobrarem o mesmo valor — nova
  `acharSobreposicoes` detecta e BLOQUEIA a criação quando isso aconteceria (mais forte que o
  aviso de "sem histórico" existente, porque aqui o dano é certo).
- **Mapeamento sala→tarefa do ClickUp gerado programaticamente** (cruzando o dropdown "Nome da
  sala" de cada tarefa real contra os `servicoOuPlano` distintos do banco), não digitado à mão —
  achou 7 salas com receita real sem tarefa correspondente ainda no ClickUp (Loja 05/08/09/11/12/
  13/14 mais 2 Estações) e confirmou que a checagem de sobreposição funciona corretamente contra
  2 grupos de fatura combinada reais.
- `scripts/seed-clickup-salas-privativas.mjs` (novo, idempotente): cria os 36 vínculos
  confirmados. Validado com dry-run duplo contra o dev DB real (segunda rodada não duplica nada).
- **O que ainda falta na integração ClickUp** (perguntado pelo usuário): depois de Salas
  Privativas, faltam vínculos pra SeaBox (Básico/Pro), Outros Serviços, Hub Empreendedoras, Meu
  Depósito, e Serviços de Espaço (mesma estrutura por sala das 3 unidades, ainda maior volume que
  Salas Privativas — 175 linhas reais). Nenhum desses tem vínculo ainda.
- Typecheck limpo, 147 testes. Nada commitado ainda — o script só pode rodar em produção depois
  do deploy destas correções.
- Commit `c93f8ce` feito e enviado (`git push`) pro `main` a pedido do usuário.

## 2026-07-28 (continuação) — SeaBox, Meu Depósito, Serviços de Espaço + proteção real no push

- **Achado de processo**: o dump inicial da lista "Eficiência" trouxe só 100 das 152 tarefas
  reais (API pagina em blocos de 100, faltou passar por todas as páginas) — isso quase levou a
  concluir errado que Meu Depósito e várias salas do Seaway Center não tinham tarefa no ClickUp.
  Corrigido paginando até `last_page`; lição registrada em memória permanente.
- **Verificação adversarial rodada em background** (3 agentes independentes, rederivando do zero
  sem ver a conclusão prévia) confirmou o mapeamento de SeaBox/Meu Depósito/Serviços de Espaço
  (Ayrton Senna/Sebrae/Seaway Center) e, com busca exaustiva em todo o workspace ClickUp (2
  espaços, 20+ pastas/listas, tarefas arquivadas), confirmou que **Outros Serviços e Hub
  Empreendedoras não têm NENHUMA tarefa no ClickUp** — nada a criar até alguém montar as tarefas.
- Usuário confirmou explicitamente: só a lista `901326339447` ("Eficiência") é alvo válido de
  vínculo, nunca outra lista do workspace mesmo que pareça relacionada.
- A pedido do usuário, "Pacote de Horas" (tarefa genérica de Serviços de Espaço - Seaway Center)
  ganhou padrões extras ("Horas do Plano Contratado", "PH -") pra cobrir variantes do mesmo
  produto que ficavam de fora (~27% das linhas), mesmo mecanismo já usado pra Comércio/Comercio.
- **Achado crítico durante o dry-run**: a proteção de sobreposição existente (`acharSobreposicoes`)
  só age na CRIAÇÃO do vínculo, comparando contra o histórico daquele momento — não protege
  contra uma fatura FUTURA que combine 2 salas cujos vínculos já existiam sem conflito na
  criação. Pra Serviços de Espaço - Seaway Center isso é sério: 29% das faturas históricas já
  combinam salas (reserva avulsa, não uma exceção). A pedido do usuário, construída proteção real
  no push: nova `linhasExclusivasDoVinculo` (testada) conectada em `pushUmVinculo`/
  `pushValoresDoMesCorrente`/`pushVinculoAgora` — todo push agora exclui linhas que também batem
  num vínculo irmão ativo mais antigo da mesma categoria (empate por `criadoEm`, desempate por
  `id`). Validado com dado real: os vínculos já criados não mudaram de valor (a proteção de
  criação já tinha filtrado os conflitos históricos); simulando uma fatura futura hipotética
  combinando 2 salas sem conflito histórico, a soma sem a correção dava R$500 a mais no vínculo
  mais novo — corrigida, some certo.
- 3 novos scripts (`seed-clickup-seabox.mjs`, `seed-clickup-meu-deposito.mjs`,
  `seed-clickup-servicos-espaco.mjs`), mesmo padrão idempotente de Salas Privativas. Dry-run
  duplo contra o dev DB real confirmou idempotência; os 17 vínculos de teste foram removidos do
  banco depois. Typecheck limpo, 152 testes.
- **Rodado em produção pelo usuário via Console do Easypanel, mesmo dia.** Diagnóstico rápido
  antes: usuário reportou "o console trava" ao rodar o primeiro script — isolado em 2 passos
  (console respondia normal a `node -e`, conexão Prisma→Postgres conectava em <1s) que não era
  nem o console nem a rede/banco; o script já tinha rodado com sucesso numa tentativa anterior (só
  não tinha ficado claro pro usuário), confirmado pelo idempotente "0 criado(s), 2 já existiam" no
  reprocessamento. Os outros 2 scripts rodaram limpos na sequência: Meu Depósito (8 criados, 2
  pulados por sobreposição) e Serviços de Espaço (7 criados, 9 pulados por sobreposição) — números
  batendo com o que o dry-run já tinha previsto.
- **`seed-clickup-salas-privativas.mjs` também rodado em produção** (usuário perguntou "algo ficou
  pendente?" e isso ainda não tinha confirmação) — falso alarme de "travado" era o comando digitado
  sem o `node` na frente; com o comando certo, rodou normal: 36 criados, 3 pulados por sobreposição,
  igual ao dry-run.
- **Gap identificado, ainda não resolvido**: Serviços de Espaço - Seaway Center só tem 4 das ~13
  salas específicas vinculadas (Auditório, Atendimento 04, Cabine, Sala de Treinamento) — as outras
  9 salas + a tarefa genérica "Pacote de Horas" foram puladas na criação por sobreposição, mesmo
  tendo receita própria limpa em outras linhas, porque a checagem de criação bloqueia o vínculo
  INTEIRO ao achar qualquer sobreposição no histórico. Agora que o push tem proteção de verdade
  (linhasExclusivasDoVinculo), esse bloqueio total na criação ficou mais conservador do que precisa
  — daria pra criar essas 9 salas e deixar o push filtrar as linhas combinadas sozinho. Proposto ao
  usuário, que confirmou ("prossiga").
- **Implementado**: `criarVinculoAction` não bloqueia mais por sobreposição, só avisa (mesmo
  padrão do aviso de "sem histórico"). `seed-clickup-servicos-espaco.mjs` atualizado do mesmo
  jeito. Dry-run contra o dev DB agora cria os 16 vínculos completos (antes só 7), idempotente.
  **Validação forte**: simulando os 16 vínculos SEM a correção do push, a soma ingênua dava
  R$66.936,32 — mais que o dobro do real; com a correção, bate exato com o total real das faturas
  (R$30.561,99, ao centavo). Typecheck limpo, 152 testes. Aguardando redeploy pra rodar de novo em
  produção (idempotente sobre os 7 vínculos já existentes).
