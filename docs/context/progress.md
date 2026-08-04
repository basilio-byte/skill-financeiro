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
  (R$30.561,99, ao centavo). Typecheck limpo, 152 testes.
- **Rodado em produção depois do redeploy**: 9 criados, 7 já existiam — 16/16 vínculos de Serviços
  de Espaço completos e ativos. Com isso, a integração ClickUp cobre todas as categorias que já têm
  tarefa correspondente no ClickUp (Endereço Fiscal, Salas Privativas, SeaBox, Meu Depósito,
  Serviços de Espaço); só Outros Serviços e Hub Empreendedoras seguem sem cobertura, por falta de
  tarefa na lista Eficiência — não resolvível pelo dashboard, depende de alguém criar as tarefas lá.

## 2026-07-28 (continuação) — Metas: mensal volta a existir, ao lado do trimestral

- Usuário pediu que mensal (removida na virada pra trimestral, ADR-0022) volte a existir, com as
  duas "visíveis/configuráveis". Confirmado antes de mexer no schema: são **séries
  independentes** — trimestre nunca é a soma dos 3 meses, mês nunca é rateio do trimestre.
- Achado que liberou redesenhar o schema à vontade: `meta_periodos` tinha **0 linhas** (nenhuma
  meta de valor definida desde 2026-07-24) — nada de dado real pra preservar/migrar.
- Novo enum `MetaGranularidade` (MES/TRIMESTRE); `anoTrimestre` virou `periodoChave` +
  `granularidade`, unique composto pelos 3 (`escopoId, granularidade, periodoChave`) — os dois
  formatos de chave (`yyyy-MM` vs `yyyy-Q#`) nunca colidem entre si por desenho, CHECK constraint
  composto garante isso no banco. Migration `20260728000000_metas_mensal_e_trimestral`.
- `periodo.ts`/`metas.ts` generalizados: `granularidadeDoKind` decide MES (mês) ou TRIMESTRE
  (trimestre/semestre/ano) por `PeriodKind`; dia/semana continuam sem meta em nenhuma
  granularidade. `/metas` ganhou alternador Mensal/Trimestral no formulário (troca os campos sem
  duplicar Server Action no mesmo `<form>` — usa `key` pra resetar o estado ao trocar) e a tabela
  virou 2 seções por escopo. Card do Panorama usa a palavra certa (mês/trimestre) e a mensagem de
  "não aplicável" (dia/semana) agora oferece os dois atalhos.
- **Validado com dado real**: script duplicando a agregação confirmou no dev DB que uma meta
  mensal (R$1.000) e uma trimestral (R$5.000) pro mesmo escopo coexistem sem cruzar. App subido
  de verdade (sessão JWT criada à mão): `/metas` com o alternador visível, Panorama em `?g=month`
  agora mostra o card de metas (antes dizia "meta é trimestral"), `?g=week` mostra a mensagem com
  os dois links. Ambiente de teste limpo depois. Typecheck limpo, 161 testes.
- Migration aplicada só no dev DB por enquanto — nada commitado nem rodado em produção ainda.
- Commitado (`1228a1c`) e enviado — deploy em produção **falhou** (P3009): a migration assumia
  `meta_periodos` vazia (só conferido no dev), mas produção já tinha 1 meta trimestral real (Q3
  2026, R$35.000,00, definida às 11:52 UTC do mesmo dia) quando o deploy rodou às 16:31 —
  `ADD COLUMN ... NOT NULL` sem DEFAULT falha numa tabela não-vazia. Transação revertida inteira,
  confirmado direto no banco (`applied_steps_count: 0`) antes de qualquer correção — nenhum dado
  perdido, app só não subiu.
- **Corrigido (`b6...` a seguir) e revalidado antes de reenviar**: migration reescrita pra
  funcionar com qualquer quantidade de linhas (adiciona colunas NULLABLE, faz backfill —
  granularidade=TRIMESTRE pra toda linha já existente, já que mensal não existia ainda — só então
  aperta NOT NULL e dropa a coluna antiga). Validado contra uma reprodução exata do cenário real
  de produção (banco de teste isolado no mesmo Postgres do dev, mesma linha/valor) antes de
  reenviar — a meta de R$35.000 sobreviveu intacta, uma meta mensal nova coexiste sem conflito.
  Registro da migration falhada removido de `_prisma_migrations` em produção (via Console do
  Postgres no Easypanel) — seguro porque a transação já tinha revertido tudo.
- **Lição registrada**: a validação anterior só tinha testado a migration contra o dev DB VAZIO —
  o mesmo ponto cego que causou o incidente. Daqui pra frente, migration que altera tabela
  existente precisa ser testada com dado real (ou uma reprodução fiel dele), não só contra uma
  tabela vazia, mesmo quando a suposição "está vazia" parece razoável.
- **2ª falha, mesmo incidente**: o deploy corrigido falhou de novo com o MESMO erro — mas era a
  imagem ANTIGA ainda rodando (confirmado consultando o histórico do GitHub Actions: o build da
  correção só terminou às 16:59:45 UTC, a falha reportada foi às 16:53:11). A causa real da 2ª
  falha era outra: o registro da tentativa de 16:53 ficou bloqueando `_prisma_migrations`
  (P3009), mesmo já existindo imagem corrigida — precisou limpar esse registro de novo antes do
  deploy seguinte rodar a versão certa. **Lição**: cada tentativa de deploy que falha cria um novo
  registro de bloqueio que precisa ser limpo de novo (não basta limpar uma vez); e antes de
  concluir "a correção não funcionou", conferir se a imagem que rodou realmente já tinha a
  correção (comparando horário da falha × horário de build no GitHub Actions).
- **Resolvido e confirmado**: subiu limpo (logs mostrando boot normal, auto-sync rodando), e a
  meta de R$35.000 (Q3 2026) confirmada visualmente em `/metas`, migrada corretamente pra seção
  Trimestral. Nenhum dado perdido durante todo o incidente.

## 2026-07-28 (continuação) — Detalhamento por vínculo ClickUp (quais faturas somam o valor)

- Pedido do usuário: botão por vínculo em `/integracoes/clickup` que expande/recolhe mostrando as
  faturas que compõem o valor (ex. "Cabine — R$ 263,75").
- **Achado que mudou o desenho**: `ClickUpPushLog` guarda só o total, nunca as linhas — a lista é
  sempre um recálculo. E ela só fecha com o valor se aplicar os mesmos 4 filtros do push,
  incluindo a exclusão de sobreposição (ADR-0025); sem o 4º, mostraria faturas a mais.
- **Fonte única em vez de reimplementar**: novo `composicao.ts` (`composicaoDoVinculo`) passou a
  ser usado tanto pela tela quanto pelo `push.ts` (refatorado) — divergir vira impossível por
  construção. `linhasExclusivasDoVinculo` agora é implementada sobre uma nova função pura
  `particionarPorReivindicacao`, que devolve também as excluídas e quem ficou com cada uma.
- **Divergência é mostrada, não escondida**: a action devolve `totalAtual` (recálculo) e
  `ultimoEnviado` (só push com sucesso); quando diferem, aviso âmbar explica que a receita mudou
  desde o envio e que a próxima sincronização corrige o ClickUp.
- Bloco recolhível extra lista as faturas que casam o padrão mas somam em OUTRO vínculo, com link
  pra tarefa que ficou com elas — responde "cadê a fatura X?", que some sem explicação hoje.
- UI segue padrões já existentes (linha expansível igual `LinhaRevisaoRow`, carga sob demanda com
  `useTransition` igual ao "Pré-visualizar", `<details>` igual `ChartCard`).
- **Validado com dado real**: nos 52 vínculos reais semeados no dev DB, o total pela lógica antiga
  do push e pela nova bateram em 100% (0 divergências) e a soma da lista fecha exato com o total
  em todos. App subido de verdade: 52 botões renderizados, 105 forms pré-existentes intactos.
  Ambiente limpo depois. Typecheck limpo, 169 testes (8 novos).

## 2026-07-28 (continuação) — Receita dividida por ITEM da fatura (ADR-0028)

- Usuário abriu a tela nova de detalhamento, viu a Cabine com R$ 263,75 e mandou o PDF da fatura
  provando que a Cabine faturou R$ 26,25 — o resto era de outras 2 salas na mesma linha.
  Perguntou "como lidamos com esse tipo de coisa?".
- **Diagnóstico**: o motor descartava o valor por item, e a proteção de sobreposição só sabia dar
  a linha inteira ao vínculo mais antigo. Provado arbitrário: a mesma fatura foi pra salas
  diferentes em produção e no dev, só por ordem de cadastro (9 ms de diferença).
- **Medido antes de decidir**: R$ 6.929,61/mês de atribuição arbitrária = 22,67% da categoria
  "Serviços de Espaço - Seaway Center"; 7 vínculos com 29-68% do número vindo de linha alheia.
- **Viabilidade confirmada no código**: `valoresPorItem` já era calculado e jogado fora. Achado
  lateral: o comentário do schema sobre `raw` ("CR + itens LV casados") era falso — corrigido.
- **Etapa 1** (guardar, sem mudar o ClickUp): `ItemDaLinha`, colunas `itensDetalhe`/
  `ajusteArredondamento` (nullable — sem risco em tabela populada). Validado com **sync real
  contra a Conexa**: invariante `soma(itens)+ajuste = valor` verdadeira em **1015/1015** linhas,
  conferência do motor em **R$ 0,00**, e os itens da fatura 27320 batendo com o PDF ao centavo.
- **Etapa 2** (dividir no push): `donoDoItem` + `composicao.ts` com modo por-item e fallback
  linha-inteira (usado em linha antiga, SEM_LV e revisada manualmente — revisão humana prevalece).
- **Destravou dinheiro parado**: como dividir agora é seguro, os seeds de Salas Privativas e Meu
  Depósito não pulam mais as salas que dividem fatura. Sala 08/09 Sebrae saíram de R$ 0,00 para
  R$ 3.858,80 e R$ 2.411,80.
- **Validação antes × depois**: nenhuma categoria excede seu total; 23 vínculos mudam; Cabine vai
  a R$ 166,25 (o valor do PDF). Caem R$ 2.916,43 do total — dinheiro de salas sem tarefa no
  ClickUp, que antes inflava a vizinha.
- Typecheck limpo, 178 testes. Revisão adversarial rodada antes do commit.
- **Revisão adversarial (8 agentes) achou 4 bugs reais, todos de informação exibida** — a dimensão
  dinheiro/precisão foi refutada (não há como criar ou duplicar valor). Corrigidos: (1) o Decimal
  do Prisma derruba zeros à direita, então a UI marcava "parte da fatura" em quase toda
  mensalidade redonda — resolvido na raiz com um campo `dividida` decidido no servidor; (2) a
  prévia de novo vínculo somava linha inteira e prometia mais do que o push entregaria — agora usa
  a mesma função do push com um vínculo hipotético; (3) o bloco "Excluídas" dizia "R$ 123,75
  somando na tarefa X" quando X levou R$ 26,25 — agora mostra a repartição real; (4) padrão com
  ";" zerava a receita silenciosamente — bloqueado na criação. Revalidado: totais idênticos aos de
  antes dos fixes.

## 2026-07-28 (continuação) — Dois ajustes no Panorama pedidos pelo usuário

- **Hora das sincronizações**: a tabela "Últimas sincronizações" mostrava só o PERÍODO coberto
  (datas), sem dizer QUANDO a rodada aconteceu — impossível distinguir as várias sincronizações
  automáticas de um mesmo dia. `iniciadoEm`/`concluidoEm` já vinham do banco mas não eram expostos
  por `buildOverview`; agora são, e a tabela tem uma coluna "Quando" com data+hora no fuso do app
  (mesmo padrão de `/integracoes/clickup`). Enquanto a rodada está RUNNING mostra o início, com a
  marca "iniciada".
- **Meta trimestral "sumindo" no Panorama** — investigado antes de mexer: **não era bug de dado nem
  de cálculo** (a meta estava gravada certa, `2026-Q3`, e aparece normalmente em `/?g=quarter`).
  Era uma armadilha de desenho criada hoje junto com a ADR-0026: o Panorama abre em **Mensal** e o
  formulário de meta abre em **Trimestral**, então o caminho mais natural (criar meta → voltar ao
  Panorama) garantia que ela não aparecesse — e o card ainda afirmava "Nenhuma meta definida para
  este período", que é falso pra quem acabou de cadastrar uma.
- **Corrigido na causa**: `buildMetas` agora também consulta a granularidade OPOSTA cobrindo o
  mesmo intervalo (`metaNaOutraGranularidade`) — nunca pra somar junto (são séries independentes),
  só pra poder avisar. O card do Panorama, quando não há meta na visão atual mas existe na outra,
  mostra um aviso âmbar nomeando o período ("existe meta trimestral em 2026-Q3"), com link direto
  pra visão certa e uma frase explicando que são metas separadas.
- Validado com dado real: criada uma meta trimestral no dev, a visão mensal passou a avisar e a
  trimestral mostra os R$ 35.000,00 normalmente. Typecheck limpo, 178 testes. Ambiente limpo.
- **Iteração seguinte, a pedido do usuário**: em vez de um aviso com link (ou de uma guia que
  trocasse o período do Panorama inteiro — cheguei a começar por esse caminho e o usuário
  interrompeu, com razão), o card de Metas passou a mostrar **mensal e trimestral LADO A LADO**,
  cada bloco apurado no SEU próprio período e exibindo o rótulo dele ("julho de 2026", "3º
  trimestre de 2026"). O Panorama não muda de período ao olhar as duas.
  - `buildMetas` foi refatorado: o miolo virou `calcularBloco(escopos, granularidade, intervalo)`
    e `blocosDaVisao(periodo)` decide quais blocos existem — visão mensal mostra o mês + o
    trimestre que o CONTÉM (intervalo maior que a página, marcado com `difereDaVisao`); visão
    trimestral mostra os 3 meses + o trimestre; semestre/ano mostram só o trimestral cobrindo o
    período inteiro, porque somar 6 ou 12 metas mensais produziria um número que ninguém definiu
    (a ADR-0026 já fixou que mês nunca soma pra cima).
  - O rótulo do período em cada bloco não é decoração: numa visão mensal o bloco trimestral apura
    o trimestre inteiro, então o realizado dele é legitimamente MAIOR que o KPI da página. Sem
    dizer o recorte de cada número, seriam duas receitas na mesma tela sem explicação — e há uma
    frase de apoio avisando disso quando os intervalos diferem.
  - Validado com dado real (meta mensal de R$ 12.000 + trimestral de R$ 35.000 no dev): visão
    mensal mostra as duas; trimestral mostra as duas; semestral/anual só a trimestral; semanal cai
    na mensagem de "não aplicável". Typecheck limpo, 178 testes. Ambiente limpo depois.

## 2026-07-28 (continuação) — Metas para mais 4 escopos (Endereço Fiscal, Meu Depósito, Salas Privativas, SeaBox)

- Pedido do usuário: além de "Serviços de Espaço", poder criar meta para Endereço Fiscal, Salas
  Privativas, SeaBox e Meu Depósito, em ordem alfabética, aparecendo no Panorama junto das demais.
- **As strings de categoria foram conferidas byte a byte antes de escritas** — errar uma faz a meta
  somar ZERO em silêncio (a armadilha da ADR-0017). Verificado por 3 ângulos: linhas gravadas
  (`revenue_categorized_lines`), tabela de regras (`revenue_category_rules`) e os `FIXED_FALLBACKS`
  de `rules.ts`, com `replace(categoria,' ','·')` pra tornar espaço duplo visível e contagem de
  char × octeto pra confirmar que os acentos são NFC (pré-compostos) e não há espaço sobrando.
- **Achado**: "Salas Privativas" repete EXATAMENTE o split de grafia de "Serviços de Espaço" — dois
  espaços após o hífen em Sebrae e Ayrton Senna, um só em Seaway Center. As duas grafias entram no
  escopo pelo mesmo motivo defensivo do escopo antigo: subcontar dinheiro em silêncio é pior que
  uma linha a mais na tela. "Endereço Fiscal", "SeaBox" e "Meu Depósito" são categorias únicas, sem
  unidade e sem variante — nenhuma variante foi inventada.
- `ordem` passou a ser alfabética (1..5), reordenando "Serviços de Espaço" de 1 para 5. É o campo
  que ordena as duas telas. Espelhado em `scripts/seed-metas.mjs`, que roda a cada boot e é a fonte
  de verdade da ESTRUTURA — então os escopos novos nascem sozinhos no próximo deploy, sem passo
  manual (ADR-0008, zero-touch boot).
- `escopos.test.ts`: o contrato que travava "existe exatamente 1 escopo" virou a trava dos 5 slugs,
  da ordem, e das grafias exatas de cada categoria — mais um teste novo ligando o escopo de Salas
  Privativas ao fallback "Coworking Estação", o único de `rules.ts` que produz essa categoria.
- **Validado contra dado real**: rodado o seed no dev, um JOIN exato (`l.categoria = mc.categoria`)
  confirmou que todos os 5 escopos casam receita — Endereço Fiscal 665 linhas / R$ 98.222,97; Meu
  Depósito 8 / R$ 6.732,03; Salas Privativas 65 (= 12+8+45, as três grafias) / R$ 159.221,86;
  SeaBox 15 / R$ 456,83; Serviços de Espaço 215 / R$ 43.089,77. **Zero categorias em mais de um
  escopo** (sem dupla contagem), e as únicas categorias descobertas são Sem Categoria, Outros
  Serviços e Hub Empreendedoras — nenhuma delas pedida.
- Smoke test das telas: os 5 aparecem no Panorama em ordem alfabética (nos dois blocos, mensal e
  trimestral) e em /metas, com o seletor do formulário oferecendo os 5. Typecheck limpo, 180 testes.

## 2026-07-28 (continuação) — Meta sobre o valor recebido TOTAL, sem categorizar (pedido da Duda)

- Pedido repassado por print: *"trimestral eu queria colocar valor recebido, sem categorizar sabe?
  como meta"*. Confirmado com o usuário que "valor recebido" = TUDO que entrou no período
  (inclusive Outros Serviços, Hub Empreendedoras e Sem Categoria, ~R$ 19 mil em julho) — o mesmo
  número do KPI "Total recebido no período", que a Duda já vê no topo do Panorama.
- **Implementado como FLAG, não como lista de categorias**: novo campo `MetaEscopo.todasCategorias`
  (migration `20260728180000_escopo_todas_categorias`, coluna booleana com default — alteração só
  de metadado no PG 11+, segura em tabela populada). Uma lista fixa com "todas as categorias de
  hoje" deixaria de fora, em silêncio, qualquer categoria criada depois em /categorias — o mesmo
  modo de falha da ADR-0017. Com a flag, o escopo soma o que existir hoje e amanhã, sem manutenção.
- Novo escopo `total-recebido` ("Total recebido", ordem 6, alfabeticamente após Serviços de Espaço),
  em `escopos.ts` e `seed-metas.mjs` (que roda a cada boot, então nasce sozinho no deploy).
- **Cuidado que evitou um bug de dupla contagem**: o cabeçalho de cada bloco soma os escopos, e um
  escopo que abrange tudo JÁ CONTÉM a receita dos outros — somá-lo contaria dinheiro duas vezes.
  O agregado passou a excluir escopos `todasCategorias`, com ressalva na tela ("não inclui 'todas as
  categorias'"), e o escopo aparece na própria linha com a marca "todas as categorias" explicando
  a sobreposição.
- **E evitou repetir o bug de hoje**: se a Duda definir SÓ a meta de Total recebido, `totalMeta`
  (agregado) fica null — antes isso dispararia "nenhuma meta definida" e a meta dela pareceria não
  existir. Novo campo `temAlgumaMeta` (inclui o escopo global) governa essa mensagem.
- `/metas` mostra, para esse escopo, "Soma toda a receita do período, sem filtrar categoria" em vez
  da lista, com o aviso de sobreposição e link para /categorias.
- Typecheck limpo, 182 testes (2 novos travando o contrato: o escopo total usa flag e lista vazia;
  só ele abrange tudo, os demais têm categorias listadas).
- **PENDENTE**: validação contra dado real (confirmar que o realizado do escopo bate ao centavo com
  o KPI "Total recebido no período"). O Docker Desktop caiu no meio do trabalho e o banco de dev
  ficou inacessível — a checagem precisa ser feita quando ele voltar, ANTES de considerar isto
  fechado.

### Validação contra dado real — feita (2026-07-30)

Docker voltou; migration `20260728180000_escopo_todas_categorias` aplicada no dev e
`seed-metas.mjs` rodado (6 escopos, `total-recebido` com `todasCategorias=true` e ZERO categorias
ligadas — como esperado, ele soma por flag).

Conferência do número, por dois caminhos independentes (SQL cru vs. página renderizada):

| | valor |
|---|---|
| SQL: `sum(valorRecebidoCat)` de julho/2026, 1036 linhas | **R$ 326.932,90** |
| KPI "Total recebido no período" no Panorama | **R$ 326.932,90** |
| Escopo "Total recebido" no card de Metas | **R$ 326.932,90** |

Os 5 escopos de categoria somam R$ 307.723,46 (665/8/65/15/215 linhas — os mesmos números já
validados em 28/07). A diferença de R$ 19.209,44 é Outros Serviços + Hub Empreendedoras + Sem
Categoria — exatamente a receita que a Duda quer dentro da meta dela e que uma lista de categorias
teria deixado de fora.

Os dois casos de borda que motivaram o código foram exercitados na tela, com meta inserida no banco:

1. **Meta SÓ no escopo global** (o caso da Duda): bloco Trimestral mostrou "R$ 326.932,90 de
   R$ 900.000,00 — 36,3% — Faltam R$ 573.067,10", e **não** apareceu nenhuma mensagem de "nenhuma
   meta trimestral". Sem o `temAlgumaMeta`, a meta dela ficaria invisível — o mesmo bug corrigido
   horas antes na visão trimestral.
2. **Meta no global E numa categoria**: agregado do bloco mostrou 98,2% (R$ 98.222,97 de
   R$ 100.000,00 — só Endereço Fiscal) com a ressalva `não inclui "todas as categorias"`. Se o
   global entrasse no agregado daria 42,5% (R$ 425.155,87 de R$ 1.000.000), contando Endereço
   Fiscal duas vezes.

`/metas` mostra o texto explicativo + aviso de sobreposição no card do escopo, e "Total recebido"
aparece no seletor do formulário, em 6º lugar (ordem alfabética). Dados de teste removidos
(0 metas, 0 sessões de smoke test no dev).

## 2026-07-30 — Card de Metas mostra só os escopos COM meta (+ dois bugs no rótulo do período)

Com o escopo "Total recebido" no ar, o usuário viu na produção o que o pedido da Duda pedia
("trimestral sem categorizar") ainda não entregando: o bloco Trimestral trazia a meta dela em cima
de **5 linhas "sem meta definida"** das categorias. Relato dele: *"os itens que eram por categoria
nas metas trimestrais não foram ocultos, e não achei opção para remover"*.

Confirmado antes de mexer que não era problema de descoberta: `MetaEscopo.ativo` só é LIDO no
código (`where: { ativo: true }` em dois lugares), nunca escrito por nenhuma tela — a opção de
remover realmente não existia.

**Escolha do usuário entre 3 desenhos** (ocultar / recolher atrás de "ver mais" / ocultar + poder
desativar escopo em `/metas`): **ocultar**. O card é sobre progresso contra meta; uma linha "sem
meta definida" não é progresso, é convite a definir — e o link "definir" do bloco já convida uma
vez. Não se criou tela de desativar escopo: desativar valeria para mensal E trimestral ao mesmo
tempo, o que é mais permanente do que o problema pedia.

- `visiveis = comMeta.length > 0 ? comMeta : bloco.escopos`. O fallback é **estrutural, não
  estético**: sem meta nenhuma no período a lista ficaria vazia e o bloco não diria nada, então
  nesse estado mostra todos como realizado (é quando a pessoa está calibrando quanto pedir).
  Deriva de `comMeta.length` e não de `temAlgumaMeta` de propósito — hoje os dois são equivalentes
  por construção em `calcularBloco`, mas assim é impossível renderizar bloco vazio se um dia
  divergirem.
- **Não é omissão silenciosa:** rodapé "N escopos sem meta mensal/trimestral — fora desta lista.
  Definir." Um escopo com receita real que desaparece sem aviso é o tipo de coisa que este projeto
  trata como bug em tela de dinheiro.

**Dois bugs no rótulo do período, o segundo encontrado pelo próprio teste que escrevi:**
1. `capitalize` do Tailwind é `text-transform:capitalize`, que maiúscula CADA palavra — a tela
   mostrava "Julho De 2026" e "3º Trimestre De 2026".
2. A primeira tentativa de correção, `first-letter:uppercase`, age no primeiro CARACTERE: no
   rótulo trimestral é o dígito "3", então o trimestral ficaria todo minúsculo ao lado de um
   mensal maiúsculo. Trocado por `comInicialMaiuscula()` em `dates.ts` (junto de
   `formatPeriodLabel`, que produz os rótulos), com 5 testes.
   - Buscar `\p{L}` **não** resolve: **"º" (U+00BA) É letra Unicode** (categoria Lo) e não tem
     maiúscula, então a busca parava nele e devolvia a string intacta.
   - Buscar "o primeiro caractere que muda ao virar maiúsculo" também não: isso é a primeira
     MINÚSCULA, então "Julho de 2026" virava "JUlho de 2026" — um teste de idempotência pegou.
   - Regra final: primeiro caractere **que tem caixa** (`toLowerCase !== toUpperCase`). Limitação
     documentada e testada: no formato de DIA ("30 de julho de 2026") a primeira letra com caixa é
     o "d" de "de"; nenhum título usa rótulo de dia hoje (o card nem existe em visão diária).

**Validado na tela, com meta real no banco, nos 4 estados que importam** (banco de dev, julho/2026):

| estado | Mensal | Trimestral |
|---|---|---|
| nenhuma meta | 6 escopos como realizado + "definir", sem rodapé | idem |
| meta só no global (= produção) | 6 como realizado | **1 linha** (Total recebido 86,5%) + "5 escopos sem meta trimestral" |
| global + 1 categoria | — | agregado 98,2% só de Endereço Fiscal + ressalva, 2 linhas, "4 escopos sem meta" |
| 1 categoria no mensal | agregado 86,2%, 1 linha, "5 escopos sem meta mensal" | — |

Contagem do rodapé confere em todos (6−1=5, 6−2=4). 187 testes, typecheck limpo. Dados de teste
removidos do dev.

### Revisão adversarial da mudança (12 agentes, 23 achados → 5 reais)

Rodada antes do commit, como manda a prática do projeto para tela de dinheiro. A maioria dos
achados foi refutada na verificação (vários descreviam estados inalcançáveis — p.ex. "o bloco
trimestral esconde tudo quando só existe meta mensal", que é falso: sem meta trimestral o bloco cai
no fallback e mostra todos). O que se sustentou:

1. **Bug que a própria mudança introduziu — meta de R$ 0,00.** O formulário aceita 0 (`min="0"`, a
   action só recusa negativo) e o banco também (`CHECK "valor" >= 0`, migration 20260722173330, cujo
   comentário registra "a UI trata '0' como sem meta definida"). Meu filtro usava `meta !== null`,
   mas `MetaRow` desenha a linha por `meta !== null && percentual !== null` — e `pct()` devolve null
   quando o alvo é <= 0. Resultado: com uma única meta de R$ 0,00, o bloco mostrava **uma linha
   escrita "sem meta definida"** tendo escondido as outras 5 justamente por não terem meta, e o
   cabeçalho exibia "—%" sobre "de R$ 0,00". Corrigido com um predicado único
   `temMetaComparavel()` usado nos dois lugares; `semMeta` e `temAgregado` passaram a derivar dele.
   Verificado na tela: agora cai no fallback honesto ("Nenhuma meta mensal... o valor abaixo é o
   realizado") em vez da tela contraditória.
   - Efeito colateral bom: `BlocoMetas.temAlgumaMeta` (criado ontem) ficou sem uso e foi removido —
     a decisão de exibição agora sai toda de `comMeta`, então a mensagem não pode contradizer as
     linhas. Campo exportado que ninguém lê, com comentário dizendo governar uma mensagem que já não
     governa, é pior que campo nenhum.
2. **O bug do `capitalize` continuava no subtítulo da própria página** (`page.tsx`), sobre a MESMA
   string: a tela mostrava "Julho De 2026" no h1 e "Julho de 2026" no card, lado a lado. Passou a
   usar o mesmo `comInicialMaiuscula()`. Um grep por `capitalize` em `src/` já não acha nenhum uso.
3. **Contraste do aviso de ocultos**: `text-slate-400` sobre branco é ~2,55:1, reprova WCAG 1.4.3
   (mínimo 4,5:1). Essa linha não é nota de rodapé — é a única coisa que avisa que escopos com
   receita real saíram da lista; se ela é o que desaparece num monitor claro, a omissão volta a ser
   silenciosa. Subiu para `text-slate-600` (~7,6:1).
4. **Tooltip do selo "todas as categorias"** dizia "inclui a dos outros escopos desta lista" — desde
   que o card mostra só quem tem meta, essa lista pode ter uma linha só. Trocado por "dos demais
   escopos".
5. **Comentário que prometia mais do que o código entrega**: dizia ser "impossível renderizar bloco
   vazio", mas o fallback não cobre `escopos.length === 0` (hoje inalcançável — quem garante isso é
   o gate `temEscopos` em `MetasPanel`, não o fallback). Comentário corrigido para afirmar só o que
   é verdade.

**Achados reais NÃO corrigidos, por decisão de escopo** (o usuário pediu para ocultar, não para
redesenhar o card):
- Num bloco cuja janela difere da visão da página (bloco Trimestral em visão Mensal), o realizado
  dos escopos ocultos não está em nenhum outro lugar da tela — o KPI e o breakdown por categoria são
  do MÊS. Aceito: é consequência direta de ocultar, e o estado em que a Duda está hoje (meta
  trimestral no Total recebido) não cai nisso.
- O rodapé conta escopos e não diz dinheiro, então "5 escopos sem meta" se lê igual escondendo R$ 0
  ou R$ 180 mil. Não incluí o valor porque somar os ocultos exigiria excluir o escopo global (a
  receita dele contém a dos outros) e a contagem passaria a divergir do valor — um número novo, e
  possivelmente errado, numa tela de dinheiro.
- O argumento "está no breakdown por categoria" é meia-verdade: o breakdown é por STRING de
  categoria, e um escopo agrega até 5 grafias (Salas Privativas). O comentário no código foi ajustado
  para não prometer o que o breakdown não entrega.
- Não há teste cobrindo a renderização do card; a parte pura de `calcularBloco` é inatingível por
  teste hoje (o módulo importa `server-only` e `prisma`). Extrair fica como dívida anotada.

### Ajuste na mesma tarde: sem meta, não aparece — sem exceção

O usuário viu na produção os dois blocos cheios de "sem meta definida" e perguntou: *"Não seria melhor:
sem meta, não aparecer na tela do panorama?"*. (Antes disso ele achou que a meta de R$ 378.000 tinha
sumido por causa do deploy — investigado e descartado: `seed-metas.mjs` nunca encosta em
`MetaPeriodo`, e a única migration com `DELETE FROM "meta_periodos"` não é idempotente, então uma
reexecução teria derrubado o boot em vez de bootar limpo. Ele mesmo havia apagado a meta.)

Removido o fallback "sem meta, mostra todos como realizado". A regra virou única e sem exceção:

- bloco com meta → só os escopos com meta, + rodapé de quantos ficaram fora;
- bloco sem meta → só a mensagem e o link (o rodapé de ocultos é suprimido: com nada visível ele
  seria a mesma frase duas vezes);
- **nenhum** bloco com meta → o card inteiro vira uma linha ("Nenhuma meta mensal (julho de 2026) nem
  trimestral (3º trimestre de 2026) — definir em Metas"), em vez de duas caixas lado a lado com uma
  frase quase idêntica cada. O predicado é o MESMO dos blocos, para a decisão do card não poder
  discordar da decisão de cada bloco.

**Texto que precisava mudar junto, senão a tela mentiria:** a mensagem dizia "Nenhuma meta mensal
para julho de 2026. **O valor abaixo é o realizado** — definir" e agora não há valor abaixo nenhum.
Virou "Nenhuma meta mensal para julho de 2026 — definir". Os dois links "definir" ganharam
`aria-label` próprio (mensal/trimestral), que num leitor de tela eram duas entradas idênticas.

**Custo declarado no cabeçalho do componente:** o realizado POR ESCOPO sai da tela quando não há
meta. A receita continua toda no Panorama (KPI + breakdown por categoria), mas o breakdown é por
STRING de categoria e um escopo agrega até 5 grafias — ele não substitui o número do escopo. Escolha
explícita do usuário, feita duas vezes.

Validado na tela nos 3 estados que mudaram: nenhuma meta em lugar nenhum (card = 1 linha), meta só no
Total recebido trimestral (mensal = 1 frase, trimestral = 1 linha + rodapé), e meta de R$ 0,00 no
mensal junto de meta real no trimestral (o zero não é comparável, então o mensal cai na frase e o
trimestral apura normal). 187 testes, typecheck limpo.

## 2026-08-04 — Divergência do fechamento de julho: receita migrando de mês (ADR-0029)

A Duda achou divergência no fechamento de julho e mandou a planilha do Conexa. Investigação
completa antes de qualquer alteração, a pedido do usuário ("nossa dashboard está quase 100%
estável, não quero regredir").

**Resultado:** R$ 376.965,94 (Conexa) contra R$ 375.868,87 (dashboard) = **R$ 1.097,07 a menos**.
Provado que são 10 cobranças que foram **reescritas de julho para agosto** — 10/10 no dia exato
previsto pela lista de datas. Causa, efeito e desenho da correção estão na ADR-0029.

**Duas hipóteses minhas caíram no caminho, ambas por medição:**
1. "Julho parou de sincronizar em 01/08 e faltam lançamentos retroativos" — havia 2 cobranças
   operadas em agosto (R$ 3.545,22) que pareciam explicar, mas o diagnóstico mostrou que elas
   ESTÃO no banco e que as faltantes eram outras 10.
2. "Escolher uma data determinística por fatura" (a opção que eu recomendei e o usuário aprovou)
   — invalidada ao descobrir que cada data é uma PARCELA. Teria descartado 11 de 12 parcelas de
   cada recorrente. Avisado ao usuário antes de escrever qualquer linha de código.

**Um achado separado, e maior, para a Duda:** nenhum mês anterior a julho é confiável — junho tem
R$ 44,5 mil no banco contra R$ 324,2 mil no Conexa, porque **nunca foi ingerido** (o app começou
em julho e o sync automático só cobre o mês corrente). Não é bug, é ingestão que não houve.
Confirmado pelo usuário. O backfill só pode ser feito DEPOIS da ADR-0029: hoje, sincronizar junho
puxaria as recorrentes de volta e as arrancaria de julho e agosto.

### Fase 0 — registro do estado ANTES (esta entrega, nada alterado ainda)

- `scripts/snapshot-antes.mjs` — somente leitura. Totais gerais, por mês, por mês×categoria,
  inventário linha a linha, e a checagem de **colisões sob a chave nova** (se houver, a migration
  falharia — mesma classe do incidente P3009 da ADR-0026, e é a razão de conferir ANTES).
- ADR-0029 com o desenho, a limitação declarada (2 parcelas no mesmo mês contam 1, igual ao
  Conexa) e o **procedimento de reversão escrito junto com o de ida**, incluindo a ordem correta
  (apagar as linhas novas ANTES de restaurar o índice antigo, senão falha por duplicidade) e a
  regra de parar se alguma linha revisada manualmente estiver no caminho.

**Dois erros meus corrigidos antes de mandar rodar em produção** (revisão do próprio material da
Fase 0):
1. O procedimento de reversão referenciava `criadoEm` para achar as linhas nascidas depois do
   deploy — **essa coluna não existe** em `RevenueCategorizedLine` (só `atualizadoEm`, reescrita a
   cada rodada). O SQL não rodaria, e isso só apareceria na hora de reverter. Trocado por uma
   regra sem timestamp: manter uma linha por (fatura, categoria) via `row_number()`, preferindo
   revisada manualmente > mês mais recente > maior id, com `NULLS LAST` porque `dataCredito` é
   nullable e NULL em comparação não elimina duplicata.
2. O snapshot despejava o inventário linha a linha — milhares de linhas para copiar de um console
   web, e redundante com o `pg_dump`. Agora imprime um sha256 do inventário (mesmo hash depois =
   inventário idêntico) e só despeja tudo com `--completo`.

Testado contra o banco de dev: roda limpo e **confirma o diagnóstico de forma independente** — a
seção 4 mostra 0 faturas em mais de um mês, que é exatamente a assinatura da sobrescrita.

### Fase 0 concluída — estado ANTES capturado em produção (2026-08-04T14:35Z)

Registro completo em `docs/context/snapshot-antes-2026-08-04.md`. Backup binário:
`/tmp/antes-adr0029-2026-08-04.dump` (313K).

**Armadilha real:** a primeira tentativa de `pg_dump` foi feita dentro do psql (prompt `odoo=#`) e
falhou em silêncio — `pg_dump` e `ls` são comandos de shell, o psql não os executa e não reclamou.
O que denunciou foi o `ls -lh` não ter retornado nada. Precisa ser na aba **Bash** do serviço do
Postgres (ou `\! pg_dump ...`). Sempre conferir o tamanho do arquivo depois; sem isso o "backup"
é uma suposição.

Números do ANTES: 1406 linhas, 1196 faturas, R$ 443.053,63, **29 revisadas manualmente** (em dev
são 0 — nenhum teste local exercita esse caminho), junho R$ 44.572,10 / julho R$ 375.868,87 /
agosto R$ 22.612,66. Nenhuma colisão sob a chave nova (a migration não vai falhar). sha256 do
inventário registrado para conferir uma eventual reversão sem comparar 1406 linhas na mão.

**As 2 faturas que aparecem em dois meses eram uma suspeita minha de dupla contagem, e eu estava
errado.** São 17132/17133, com `chaveLinha` DIFERENTE nos dois meses ("Sem Categoria" em julho,
"Serviços de Espaço -  Sebrae" em agosto): a skill não sabia mapear o serviço em julho, um humano
revisou a linha, depois uma regra foi criada em `/categorias` e a categoria da skill mudou. Chave
diferente ⇒ a rodada de agosto criou linha nova em vez de sobrescrever. E como essas cobranças têm
crédito em 02/07 e 02/08, R$ 75 em cada mês é o valor CERTO — duas parcelas.

Isso é a melhor evidência disponível de que o desenho da ADR-0029 funciona: **quando a chave
difere, os dois meses coexistem com o valor correto.** A coluna `mesCredito` só fará de propósito,
para todas as recorrentes, o que aqui aconteceu por acidente.

### Fase 1 — código da ADR-0029 escrito (commit LOCAL, **sem push**: push = deploy automático)

Quatro pontos dependiam da chave, e o perigoso não era o óbvio:

1. `mes-credito.ts` (novo, puro, 9 testes): `mesDoCredito` lê em **UTC**. `dataCredito` é `@db.Date`
   e chega meia-noite UTC; lido no fuso do app (UTC−3) o dia 1º vira o mês ANTERIOR. Como o mês
   agora é IDENTIDADE, esse erro não mostraria número errado — criaria linha duplicada. Mesmo bug
   de fuso que o projeto já corrigiu duas vezes (ADR-0013 e ADR-0023).
2. **A limpeza de órfãs foi reescopada ao mês da rodada** — o ponto de maior risco. O
   `crConexaId IN (...)` de `existentes` não tinha escopo de data; com o mês na chave, a rodada de
   agosto traria as linhas de JULHO da mesma recorrente, elas não estariam no resultado de agosto,
   seriam classificadas como órfãs e **apagadas**. Trocaríamos "a receita migra de mês" por "a
   receita some de vez". Dois cintos: o escopo na query e um `continue` explícito antes de
   qualquer linha virar candidata a órfã.
3. **A conferência de conflito passou a ser por (fatura, mês)**. O valor de referência é o de UMA
   parcela; somar os meses todos de uma recorrente acusaria conflito em toda parcelada, todo mês.
4. **`/conflitos` idem** — agrupava por fatura. Isso já produz falso positivo HOJE nas faturas
   17132/17133 (R$ 75 + R$ 75 contra um `valorRecebidoTotal` de R$ 75), então a correção também
   apaga um alarme falso que já existia.

Migration com o padrão defensivo da ADR-0026: coluna nullable → backfill → `SET NOT NULL` →
índice novo → só então derruba o antigo. Aplicada no dev: 1036 linhas, total intacto
(R$ 326.932,90), zero colisões. Typecheck limpo, **196 testes** (9 novos).

**Ainda NÃO foi para produção.** Falta a Fase 2 (validar num banco isolado com cópia do dado real
— produção tem 29 linhas revisadas manualmente e o dev tem 0, então nenhum teste local exercita
esse caminho) e a revisão adversarial do reescopo das órfãs.

### Fase 1 (v2) — a revisão adversarial achou DOIS BUGS CRÍTICOS meus; corrigidos

32 agentes, 4 lentes, cada achado passando por um verificador que tenta refutá-lo. Os dois que
sobreviveram eram **críticos e meus**, ambos pela mesma causa raiz: eu escopei a decisão de órfã
pela **janela da rodada** em vez da verdade do Conexa.

1. **Janela cruzando dois meses APAGAVA o mês que a rodada não emitiu.** A rodada só consegue
   emitir UMA parcela por fatura (`parseDataCreditoNoPeriodo` devolve uma data), então a linha do
   outro mês parecia órfã. E não é cenário exótico: **"Aplicar agora" em `/categorias` monta a
   janela de min a max das datas de crédito** — multi-mês por construção. Pior: o backfill de
   junho que a própria ADR-0029 promete habilitar apagaria julho, o mês que a Duda está fechando.
2. **Data corrigida de julho para agosto no Conexa deixava a linha de julho inalcançável** por
   qualquer ramo da busca — lixo eterno, com os dois meses contando a mesma receita. **Regressão
   que eu introduzi**: antes, o ramo por `crConexaId` não tinha escopo de mês e a encontrava.

**Correção:** a decisão passou a usar `mesesCreditoDaFatura()` — a lista COMPLETA de datas de
crédito, que já vem inteira na exportação. Novo módulo puro `orfas.ts` com `decidirOrfas()`:

- mês que a rodada **cobriu** e a linha não foi produzida → órfã (o caso clássico do bucket que
  muda de categoria);
- mês que a rodada **não cobriu** → só é órfã se sumiu da lista do Conexa;
- fatura ausente da rodada ou sem lista legível → só julga dentro da janela, silêncio fora dela.

**Um terceiro bug foi pego pelos meus próprios testes**: a primeira versão da regra nova deixava
de apagar o bucket que muda de categoria dentro do mesmo mês — o que dobraria a receita da fatura
naquele mês. Daí a distinção entre "mês coberto" e "mês não coberto".

`orfas.test.ts` (8 testes) trava os três cenários, com os dois críticos em primeiro lugar de
propósito. A revisão notou que esse laço — o trecho que APAGA linhas de receita — não tinha um
único teste; agora tem. O `deleteMany` também passou a logar quantas linhas remove: apagar receita
não pode ser silencioso.

204 testes, typecheck limpo. **Continua sem push.**

**Pendente da Fase 2:** o smoke test end-to-end (rodada real de agosto com julho no banco) não
rodou — o POST em `/api/runs` respondeu 307 para login com a sessão forjada, caminho de auth
diferente do das páginas. Isso pertence à Fase 2 de qualquer forma, que precisa ser contra cópia
do dado real de produção (29 linhas revisadas manualmente; dev tem 0).

### Retomada em sessão nova

`docs/context/HANDOFF-adr0029.md` foi escrito para ser **o único arquivo necessário** para
continuar: estado dos commits, números para conferir sem recalcular, decisões que não devem ser
reabertas, os três bugs já corrigidos, o que falta nas Fases 2 e 3, e onde está o backup.

### Fase 2 — validada contra cópia real de produção (2026-08-04, mesma sessão de retomada)

O obstáculo do smoke test (307 no `/api/runs` com sessão forjada) foi contornado chamando
`startCategorizationRun` direto (é uma função pura, sem HTTP) via `tsx`, contra um banco isolado —
nunca contra produção nem contra o dev.

**Como o dado real chegou até o teste, sem tocar produção:** porta do Postgres de produção exposta
temporariamente no Easypanel (autorização explícita do usuário, revertida depois), `pg_dump -Fc`
completo do banco `odoo` (produção é PostgreSQL 17.10 — precisou do client `postgres:17-alpine`, o
client 16 do container de dev local recusa com "server version mismatch"), restaurado num
container Postgres 17 descartável (`adr0029-test-pg`, removido ao final). Rodar o script via `tsx`
exigiu `NODE_OPTIONS="--conditions=react-server"` — sem isso, `import "server-only"` (presente em
`db.ts`/`env.ts`) lança em qualquer execução Node fora do bundler do Next; a condição de export
`react-server` do pacote aponta pro `empty.js` em vez do `index.js` que lança.

**Estado restaurado (produção, agora mesmo — já maior que o snapshot de Fase 0 pelo auto-sync
rodando sem parar com o código antigo):** 1410 linhas, 1200 faturas, R$ 443.695,75, **29 revisadas
manualmente**. Migration aplicada limpa: `mesCredito` 100% preenchido, zero colisões sob a chave
nova, total intacto.

**As três verificações que a ADR pedia, todas passaram:**

1. Sincronização de julho (01–31/07): `totalRecebido` = **R$ 376.965,94** — bate ao centavo com o
   número-alvo. `diferencaConferencia = 0`. Zero linhas apagadas (o log de exclusão só dispara
   quando `idsParaApagar.length > 0`, e não disparou).
2. Sincronização de agosto (01–31/08) logo em seguida: `diferencaConferencia = 0`, zero linhas
   apagadas, nada de julho foi tocado.
3. **As 29 linhas revisadas manualmente ficaram byte a byte idênticas** antes e depois das duas
   rodadas (diff exato do snapshot antes/depois, nenhuma mudou categoria, valor ou mês).

**Verificação adversarial extra, não pedida no HANDOFF mas justificada pelo risco** (é o cenário
exato dos dois bugs críticos da revisão da sessão anterior): rodada com janela cruzando julho→agosto
(20/07 a 10/08), replicando como "Aplicar agora" em `/categorias` monta a janela. Total geral
idêntico antes/depois (R$ 445.980,74), julho e agosto mantiveram cada um o seu total, as 29
revisadas continuaram intactas. 3 linhas foram removidas (órfãs legítimas — bucket que mudou de
categoria dentro do mês coberto) sem alterar nenhum total, confirmando que a distinção "mês
coberto vs. não coberto" de `orfas.ts` está funcionando como desenhado.

**Achado real para a Fase 3, não é bug:** a sincronização de julho revelou **2 conflitos novos** —
faturas 15734 (R$ 64,50) e 15476 (R$ 933,42) — que **hoje não aparecem em `/conflitos`** porque o
auto-sync nunca retoca julho; só surgem quando alguém sincroniza julho manualmente. Confirmado
contra o dump original intocado que a linha automática ("Serviços de Espaço - Sebrae") NÃO existia
antes do teste — foi criada pela minha sincronização de teste, prova de que é um conflito latente,
não uma inflação já visível hoje. Soma ao lado dos 2 já conhecidos (17132/17133): R$ 1.097,92 de
dupla contagem temporária na tela até alguém resolver — a reconciliação da rodada
(`diferencaConferencia`) já fecha em zero porque ela mede o motor, não a tabela persistida; é a
tabela persistida (e o Panorama, que soma `valorRecebidoCat` direto sem dedup — ADR-0013) que fica
inflada até a resolução.

> **Correção (2026-08-04, Fase 3 real):** eu tinha classificado esses 2 como `manual_superada`
> (mesma categoria, resolvível com um clique) — **errado**. Rodando em produção de verdade,
> `/conflitos` não mostrou botão de resolução automática: `classificarConflito` classificou como
> `ambiguo`, porque as categorias DIVERGEM (manual "Salas Privativas - Seaway Center"/"Endereço
> Fiscal" vs. automática "Serviços de Espaço - Sebrae" — nenhuma é claramente a duplicata). Eu tinha
> checado só que o padrão de forma era igual ao de manual_superada sem confirmar que a categoria
> batia — não bati. Ver `src/lib/categorization/classificar-conflito.ts`. As duas faturas têm
> `servicoOuPlano = "Cliente Avulso"` (o nome genérico que a ADR-0020 já apontou como o caso
> clássico que o motor nunca mapeia sozinho) — parece que uma regra real foi criada para "Cliente
> Avulso" → "Serviços de Espaço - Sebrae" depois das revisões manuais, e agora pode estar
> discordando de clientes reais que usam o mesmo nome de plano genérico mas são de categorias
> diferentes. **Precisa de decisão da Duda, não é mecânico.** Script de apoio:
> `scripts/diagnostico-cliente-avulso.mjs "Cliente Avulso"` — mede quantas faturas/clientes
> distintos usam esse nome de plano e como a regra está categorizando cada um, pra saber se é só
> essas 2 faturas ou uma regra mais ampla errando silenciosamente em outras (sem revisão manual pra
> comparar, essas outras nunca aparecem em `/conflitos`).

Scripts de teste (`scripts/tmp-fase2-*.ts`), o dump e o container descartável foram todos apagados
ao final — nada disso é para persistir no repo.

**Ainda sem push.** Fase 3 (rodar em produção de verdade) depende de decisão explícita do usuário —
push neste projeto é deploy automático.
