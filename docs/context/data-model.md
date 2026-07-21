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
- **`RevenueCategorizationRun`** — uma rodada (período, status RUNNING/DONE/FAILED,
  totais, resumo por categoria em JSON, erro se falhou).
- **`RevenueCategorizedLine`** — uma linha de saída por (fatura CR × categoria). Múltiplas
  linhas por fatura quando `proporcionado = S` (rateio entre categorias). `raw` guarda a
  fatura CR de origem para auditoria. `servicoOuPlano` guarda o nome EXATO que foi buscado
  contra `RevenueCategoryRule` (Serviço/Item do LV, ou Plano Contratado do CR quando
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

## Fluxo de uma rodada
1. `startCategorizationRun` (`src/lib/categorization/run.ts`) cria o registro RUNNING.
2. `fetchBothExports` (conexa-web/client.ts) loga no Conexa e baixa os dois xlsx.
3. `readXlsxAsObjects` (xlsx/reader.ts) + `parseContasReceberRows`/`parseListarVendasRows`
   (categorization/parse-exports.ts) → linhas tipadas.
4. Filtro por status aceito (`STATUS_ACEITOS_CR`/`STATUS_ACEITOS_LV`).
5. `joinContasReceberComListarVendas` (join.ts) cruza por (Cliente ID, ano-mês).
6. `categorizeInvoices` (categorize-invoices.ts) categoriza + rateia (rateio.ts) → resultado.
7. Persiste linhas + atualiza o run para DONE (ou FAILED com `erro`, se algo falhar antes).
8. `/runs/[id]` mostra o resumo; `/api/runs/[id]/export` regenera o `.xlsx`
   (categorization/export-xlsx.ts) a partir das linhas persistidas.

## Telas
- **`/` (Panorama)** — `src/lib/reports/overview.ts` escopa KPIs e breakdowns (categoria,
  conta) a UM período selecionado (diário/semana/mês/trimestre/semestre/ano —
  `PeriodControls`, `src/lib/dates.ts`, ADR-0011), filtrando por `dataCredito`. Mostra também
  uma tendência dos últimos 12 buckets da mesma granularidade (`PeriodBarChart`, série
  única). Todas as somas cross-rodada passam por `linhasDeduplicadasPorFatura()` — cada
  fatura conta uma única vez, globalmente (nunca escopado ao período aberto): revisão
  manual vence sempre, senão a rodada CONCLUÍDA mais recente (ADR-0012; rodadas se
  sobrepõem quando o mesmo período é reprocessado). "Últimas rodadas" continua
  global e NÃO deduplicado (histórico operacional — cada rodada mostra o que ELA calculou).
- **`/runs`, `/runs/[id]`** — disparo de rodada e detalhe/export. Em "Faturas para revisar"
  (linhas `S`/`SEM_LV`), cada linha é editável (categoria/valor) via
  `updateCategorizedLineAction` (ADMIN) — ADR-0010. A edição recalcula
  `resumoPorCategoria`/`totalRecebido` da rodada na mesma transação.
- **`/categorias`** — tabela de regras + seção "Pendências de categorização" (linhas com
  `categoria = "Sem Categoria"`, agrupadas por `servicoOuPlano`, com contagem/total/amostras
  e um form de criação já preenchido com o nome — cadastrar aqui corrige só rodadas
  FUTURAS, não reprocessa retroativamente as já persistidas).
- **`/contas`** (admin) — gestão de usuários (criar/editar/resetar senha/excluir) +
  auditoria de login, portado do projeto irmão com as mesmas guardas (nunca ficar sem
  admin ativo, ninguém se tranca fora).
- **`/minha-conta`** — troca da própria senha.
