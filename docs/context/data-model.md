# Modelo de dados

## Autenticação (copiado do padrão do projeto irmão)
- `User` (email, passwordHash, role ADMIN|VIEWER), `Session` (JWT+cookie, revogável no
  banco), `LoginEvent` (auditoria de tentativas de login).

## Categorização de receita
- **`RevenueCategoryRule`** — tabela de categorização (nome do serviço/plano → categoria),
  editável em `/categorias`. Semeada de `prisma/seeds/categorizacao-inicial.csv`
  (`npm run db:seed-categories`). Match é feito por `src/lib/categorization/rules.ts`:
  exato → exato sem sufixo (Mensal/Anual/Bianual) → maior prefixo → fallback fixo →
  "Sem Categoria".
- **`RevenueSyncRun`** (ADR-0013, antes `RevenueCategorizationRun`) — um LOG de execução
  (período, origem MANUAL/AUTOMATICO, status RUNNING/DONE/FAILED, totais, resumo por
  categoria em JSON, erro se falhou). Desde a ADR-0013 não é mais dona exclusiva das linhas
  que produziu — `totalRecebido`/`resumoPorCategoria` são um snapshot CONGELADO do que essa
  execução calculou no momento, nunca recalculado depois (nem por uma revisão manual
  posterior). `totalLinhasNovas`/`totalLinhasAtualizadas`/`totalLinhasOrfasPreservadas`
  registram o efeito do upsert dessa rodada; `totalFaturasComConflito` sinaliza faturas cuja
  soma de linhas não bate com o valor total (possível dupla contagem — ver financial-rigor.md
  #11), nunca corrigido automaticamente.
- **`RevenueCategorizedLine`** — uma linha de saída por bucket (fatura CR × categoria).
  Múltiplas linhas por fatura quando `proporcionado = S` (rateio entre categorias). `raw`
  guarda a fatura CR de origem para auditoria. `servicoOuPlano` guarda o nome EXATO que foi
  buscado contra `RevenueCategoryRule` (Serviço/Item do LV, ou Plano Contratado do CR quando
  `SEM_LV`) — inclusive quando a busca deu certo. É o que alimenta a seção "Pendências de
  categorização" em `/categorias`: para faturas com múltiplos itens onde algum item não é
  mapeado, `categorize-invoices.ts` agrupa por `(categoria, nome)` em vez de só `categoria`
  quando a categoria é "Sem Categoria" — assim dois serviços diferentes e ambos não
  mapeados na MESMA fatura não se fundem numa linha só (cada um precisa aparecer separado
  para o financeiro conseguir cadastrar a categoria certa de cada um).
  `revisadoManualmente`/`revisadoPorId`/`revisadoEm` + `categoriaOriginal`/
  `valorRecebidoCatOriginal` (ADR-0010): única exceção admitida ao "segue a skill à risca"
  (ver financial-rigor.md #9) — o snapshot `*Original` só é preenchido na primeira revisão,
  nunca depois, e é a referência permanente do que a skill calculou.
  **`chaveLinha`** (ADR-0013) — identidade estável do bucket (`chaveLinhaDoBucket()` em
  `categorize-invoices.ts`: a categoria que a SKILL calculou, nunca a sobrescrita por
  revisão manual), persistida uma vez e nunca recalculada depois.
  **`@@unique([crConexaId, chaveLinha])`** — garante uma única linha atual por bucket;
  `ultimaRodadaId` (não mais uma FK "dona", `onDelete: Restrict`) registra só qual foi a
  última `RevenueSyncRun` a tocar a linha.

## Fluxo de uma rodada (manual, via `/runs`, ou automática, a cada 15 min)
1. `startCategorizationRun` (`src/lib/categorization/run.ts`) recusa rodar se já existe uma
   `RevenueSyncRun` com `status = RUNNING` (ADR-0013); senão cria o registro RUNNING.
2. `fetchBothExports` (conexa-web/client.ts) loga no Conexa e baixa os dois xlsx.
3. `readXlsxAsObjects` (xlsx/reader.ts) + `parseContasReceberRows`/`parseListarVendasRows`
   (categorization/parse-exports.ts) → linhas tipadas.
4. Filtro por status aceito (`STATUS_ACEITOS_CR`/`STATUS_ACEITOS_LV`).
5. `joinContasReceberComListarVendas` (join.ts) cruza por (Cliente ID, ano-mês).
6. `categorizeInvoices` (categorize-invoices.ts) categoriza + rateia (rateio.ts) → resultado,
   já com `chaveLinha` por linha.
7. `persistLinhasCategorizadas` (`categorization/persist.ts`) faz upsert por
   `(crConexaId, chaveLinha)` — nunca cria linhas novas para um bucket que já existe;
   protege `categoria`/`valorRecebidoCat` de linhas `revisadoManualmente`; apaga linhas
   órfãs não-revisadas. TUDO isso (leitura + delete + upserts) roda numa única transação
   Serializable, assim como `updateCategorizedLineAction` (financial-rigor.md #11) — sem os
   dois lados serializáveis, o Postgres não detecta um conflito entre uma sincronização e uma
   revisão manual acontecendo ao mesmo tempo. Atualiza o run para DONE (ou FAILED com `erro`,
   se algo falhar antes).
8. `/runs/[id]` mostra o resumo congelado da rodada; `/api/runs/[id]/export` regenera o
   `.xlsx` a partir das linhas cujo `ultimaRodadaId` é essa rodada (estado ATUAL delas, que
   pode já refletir sincronizações/revisões posteriores).

## Agendador automático (ADR-0013)
`src/instrumentation.ts` (hook de boot do Next.js) chama `scheduleAutoSync()`
(`src/lib/scheduler/auto-sync.ts`), que dispara `startCategorizationRun` com
`origem: "AUTOMATICO"` para a janela "mês corrente" (`computeAutoSyncWindow()` em
`auto-sync-window.ts`, dia 1 até agora) a cada `SYNC_INTERVAL_MINUTES` (default 15),
controlado por `SYNC_AUTO_ENABLED`. Reagenda-se via `setTimeout` só após o tick anterior
terminar — nunca sobrepõe sincronizações.

## Telas
- **`/` (Panorama)** — `src/lib/reports/overview.ts` escopa KPIs e breakdowns (categoria,
  conta) a UM período selecionado (diário/semana/mês/trimestre/semestre/ano —
  `PeriodControls`, `src/lib/dates.ts`, ADR-0011), filtrando por `dataCredito`. Mostra também
  uma tendência dos últimos 12 buckets da mesma granularidade (`PeriodBarChart`, série
  única). Desde a ADR-0013, é um `findMany` direto — o modelo de upsert por fatura já
  garante uma linha por bucket, sem precisar de SQL especial de deduplicação (ver ADR-0012,
  substituída). "Últimas rodadas" continua global e mostra o snapshot congelado de cada
  execução (pode não bater com o Panorama, que reflete sincronizações/revisões depois).
- **`/revisar`** (ADR-0013) — fila de trabalho GLOBAL e sempre atual: todas as linhas
  `S`/`SEM_LV` do sistema, não-revisadas primeiro. Substitui, para o uso do dia a dia, a
  visão por-rodada (que esvazia com o tempo à medida que sincronizações mais novas assumem
  as linhas).
- **`/runs`, `/runs/[id]`** — disparo de rodada manual e histórico/export. Em "Faturas para
  revisar" de `/runs/[id]` (linhas `S`/`SEM_LV` cujo `ultimaRodadaId` é essa rodada), cada
  linha é editável (categoria/valor) via `updateCategorizedLineAction` (ADMIN) — ADR-0010.
  Desde a ADR-0013, a edição NÃO recalcula mais o resumo da rodada (esse conceito não existe
  mais — o resumo de cada rodada fica congelado); os números ao vivo vêm do Panorama/`/revisar`.
- **`/categorias`** — tabela de regras + seção "Pendências de categorização" (linhas com
  `categoria = "Sem Categoria"`, agrupadas por `servicoOuPlano`, com contagem/total/amostras
  e um form de criação já preenchido com o nome — cadastrar aqui corrige só rodadas
  FUTURAS, não reprocessa retroativamente as já persistidas).
- **`/contas`** (admin) — gestão de usuários (criar/editar/resetar senha/excluir) +
  auditoria de login, portado do projeto irmão com as mesmas guardas (nunca ficar sem
  admin ativo, ninguém se tranca fora).
- **`/minha-conta`** — troca da própria senha.
