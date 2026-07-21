# Decisões (ADRs)

## ADR-0001 — Fork enxuto do seahub_financeiro
**Contexto:** já existe um dashboard financeiro maduro para a Seahub (`seahub_financeiro`),
com stack e infra de deploy validadas em produção (Next.js/Prisma/Postgres, Docker+Easypanel).
**Decisão:** reaproveitar a mesma stack e os módulos genéricos (Dockerfile, auth,
money.ts, xlsx writer, allocateProportionally) quase verbatim; escrever só o que é
específico do categoriza-receita (conexa-web client, xlsx reader, motor de categorização).
**Status:** aceito.

## ADR-0002 — Ingestão via login web do Conexa, não API REST/upload manual
**Contexto:** o filtro "Data de Crédito da Cobrança" que o financeiro usa para fechar o
período de uma rodada não existe na API REST v2 (confirmado por busca exaustiva na coleção
Postman) — só existe na tela de export administrativa (autenticação por sessão de usuário).
A skill OpenClaw original (`categoriza-receita`) contorna isso pedindo pro financeiro
exportar manualmente e subir os arquivos.
**Decisão:** o app loga sozinho na tela do Conexa (usuário/senha em `CONEXA_WEB_USERNAME`/
`CONEXA_WEB_PASSWORD`, uma superfície de credencial separada do `CONEXA_API_TOKEN` do
projeto irmão) e baixa os dois exports via URL parametrizável — validado ao vivo em
2026-07-21. Elimina o passo manual de upload.
**Risco aceito:** mecanismo não-oficial; pode quebrar se o Conexa mudar a tela admin. Plano B
(não implementado): reintroduzir upload manual dos dois arquivos — o parser/motor de
categorização não muda, só a origem dos bytes.
**Status:** aceito.

## ADR-0003 — Exceção documentada ao princípio "nunca chutar categoria pelo nome"
**Contexto:** o projeto irmão estabelece (ADR-0014/ADR-0019 de lá) que categoria nunca deve
ser adivinhada por nome/prefixo — sempre join por ID. O categoriza-receita, porém, é
fundamentalmente baseado em correspondência de nome/prefixo contra uma tabela mantida pelo
financeiro.
**Decisão:** manter o método de correspondência por nome (exato → sufixo → maior prefixo →
fallback fixo → "Sem Categoria"), pois a tabela (`RevenueCategoryRule`) é curada pelo time
financeiro (Duda) — não é um palpite de código, é conhecimento de negócio versionado.
Diferente de "advinhar" categoria a partir de texto livre não validado.
**Consequência:** a tabela precisa ser editável dentro do app (não só um seed estático),
porque novos serviços aparecem com o uso — ver tela `/categorias`.
**Status:** aceito.

## ADR-0004 — Persistir cada rodada no Postgres
**Contexto:** a skill original só gera um `.xlsx` avulso por rodada, sem histórico consultável.
**Decisão:** `RevenueCategorizationRun` + `RevenueCategorizedLine` guardam cada rodada e cada
linha categorizada. O `.xlsx` de saída é regenerado sob demanda a partir das linhas
persistidas (`GET /api/runs/[id]/export`) — não guardamos o binário no banco.
**Status:** aceito.

## ADR-0005 — Deploy 100% isolado do seahub_financeiro
**Contexto:** os dois projetos atendem à mesma empresa, mas são produtos/repos diferentes.
**Decisão:** banco Postgres próprio, imagem Docker própria, serviço Easypanel próprio —
nada compartilhado. Evita qualquer risco ao dashboard já em produção.
**Status:** aceito.

## ADR-0006 — Leitor de xlsx sem dependência (simétrico ao writer)
**Contexto:** o projeto irmão já tem um escritor de `.xlsx` sem dependência (ADR-0017 de lá).
Os exports do Conexa vêm em DEFLATE (diferente do STORE do writer).
**Decisão:** `src/lib/xlsx/reader.ts` usa `node:zlib.inflateRawSync` (nativo do Node) +
parsing manual de ZIP/sharedStrings/sheet XML — validado empiricamente contra os dois
arquivos reais baixados em 2026-07-21 antes de escrever qualquer código.
**Risco aceito:** escopo pequeno (uma aba, sem células mescladas/fórmulas). Se um export
futuro quebrar essas suposições, trocar por uma lib auditada (`exceljs`) é uma troca de
módulo isolada — a interface (`readXlsxAsObjects`) não muda.
**Status:** aceito.

## ADR-0007 — Publicação de imagem automática via GitHub Actions → GHCR
**Contexto:** o projeto irmão publica a imagem manualmente (`docker build` + `docker push`
local) porque a cota de GitHub Actions da conta estava esgotada na época. Aqui não há esse
bloqueio conhecido.
**Decisão:** `.github/workflows/docker-publish.yml` builda e publica
`ghcr.io/basilio-byte/skill-financeiro` a cada push na `main` (+ disparo manual via
`workflow_dispatch`), sempre com duas tags: `latest` e o short-sha do commit — nunca só
`latest`, para sempre ser possível saber qual commit está rodando em produção (mesmo
princípio do projeto irmão, só que automatizado em vez de manual).
**Consequência:** o Easypanel consome `:latest` direto do GHCR — não é mais preciso rodar
`docker build`/`docker push` manualmente a cada deploy, só dar push na `main`.
**Status:** aceito.

## ADR-0008 — Seed de categorias automático no boot, mas só uma vez
**Contexto:** o primeiro deploy exigia um passo manual (`npm run db:seed-categories` via
console do Easypanel) — o usuário pediu para eliminar todo passo manual do deploy.
**Decisão:** `scripts/seed-categories.mjs` (reescrito de TS/tsx para JS puro, mesmo espírito
de `bootstrap-admin.mjs`, sem dependência extra na imagem) roda automaticamente no
`docker-entrypoint.sh` a cada boot, mas só semeia se `RevenueCategoryRule` estiver **vazia**
— nunca reaplica o CSV por cima de uma tabela já populada.
**Por quê não rodar sempre (upsert):** depois do primeiro boot, a tabela passa a ser
gerenciada pela tela `/categorias`. Se o seed reaplicasse o CSV a cada restart via upsert,
qualquer correção manual do financeiro para um nome que já existia no CSV original seria
silenciosamente revertida no próximo deploy — um bug de rigor sério (dado editado pelo
usuário sendo pisado por dado versionado no repo).
**Falha não derruba o boot:** diferente do `prisma migrate deploy` (que aborta o container
se falhar — uma migration quebrada é grave), uma falha no seed de categorias só gera um
aviso no log; a aplicação sobe mesmo assim (com `/categorias` vazia, corrigível na hora).
**Status:** aceito.

## ADR-0009 — Layout/identidade visual e telas novas portados do projeto irmão
**Contexto:** usuário pediu para copiar o layout do `seahub_financeiro` (logo, gráficos,
paleta), renomear o produto para "Financeiro Seahub" e adicionar uma tela de Panorama e
uma de Contas.
**Decisão:**
- Reaproveitado quase verbatim: `public/logo.png`, paleta Tailwind `seahub-*`, `Card`/
  `SectionTitle` (`components/ui.tsx`), `KpiCard`, `ChartCard` (card com tabela gêmea
  acessível), `BreakdownList` (ranking de uma matiz só — MAGNITUDE), e a tela `/contas`
  inteira (gestão de usuários + auditoria de login), incluindo as guardas de "nunca ficar
  sem admin" e "ninguém se tranca fora" (`user-guards.ts`/`user-actions.ts`).
- **Não** reaproveitado: `SERIES`/`DIVERGING` (par receita×despesa com polaridade) — este
  app não tem despesa nem "resultado" negativo, só ranking de categorias/contas. Os
  gráficos daqui usam só `MAGNITUDE` (uma matiz), inclusive o gráfico de "total recebido
  por rodada" (série ÚNICA — sem legenda, o título já nomeia a série).
- **Nome exibido no app** é "Financeiro Seahub" (título, cabeçalho, tela de login). O nome
  técnico do repositório/pacote/imagem GHCR continua `skill-financeiro` — trocar isso
  quebraria a referência da imagem no CI e exigiria renomear o repo no GitHub, fora do
  pedido original.
**Status:** aceito.

## ADR-0010 — Revisão manual de linha categorizada (única exceção à skill)
**Contexto:** "Faturas para revisar" era só uma listagem — o financeiro não tinha como
corrigir uma categoria ou valor errado sem reprocessar a rodada inteira. O usuário pediu
essa capacidade, mas com uma regra: TUDO deve seguir a skill categoriza-receita à risca,
exceto dado explicitamente revisado à mão.
**Decisão:** `RevenueCategorizedLine` ganha `revisadoManualmente`/`revisadoPorId`/
`revisadoEm` + snapshot `categoriaOriginal`/`valorRecebidoCatOriginal` (preenchido só na
PRIMEIRA revisão, nunca sobrescrito depois — é a referência permanente do que a skill
calculou). `updateCategorizedLineAction` (ADMIN only) edita categoria/valor de uma linha e,
na MESMA transação, recalcula `resumoPorCategoria`/`totalRecebido` da rodada a partir de
TODAS as linhas — para que o resumo da rodada e o Panorama nunca fiquem dessincronizados
de uma revisão já feita.
**Por que não reprocessar a fatura inteira:** editar só a linha tocada (não redistribuir
automaticamente entre as demais linhas de uma fatura rateada) é mais simples e não arrisca
"corrigir" algo que o financeiro não pediu para mexer — o preço é que, depois de uma edição,
a soma das linhas de uma fatura rateada pode não bater mais com `valorRecebidoTotal`; isso é
aceito como responsabilidade de quem revisa (fica visível o valor original para conferência).
**Status:** aceito.

## ADR-0011 — Panorama por período (semana/mês/trimestre/semestre/ano)
**Contexto:** o Panorama agregava TODAS as rodadas concluídas de uma vez, sem recorte de
tempo — usuário pediu visualização semanal/mensal/trimestral/semestral/anual, no espírito do
`PeriodControls`/`getPeriodBounds` do projeto irmão (que só tinha dia/semana/mês/ano).
**Decisão:** `src/lib/dates.ts` (portado e estendido com trimestre/semestre, usando
`date-fns` — já era dependência do scaffold) + `PeriodControls` (portado, sem o seletor de
unidade que não existe aqui). `buildOverview(kind, ref)` escopa KPIs e os breakdowns
categoria/conta ao período selecionado, filtrando por `dataCredito` (o mesmo campo que já
organiza todo o resto do app) — e monta uma tendência dos últimos 12 buckets da mesma
granularidade terminando no período selecionado, numa única query (janela ampla, agregada em
memória). "Últimas rodadas" continua global/não escopado (é histórico operacional, não
uma métrica financeira do período). Adicionado depois (mesma sessão, pedido do usuário):
granularidade "Diário" (`day`), no mesmo padrão das demais.
**Status:** aceito.

## ADR-0012 — Deduplicação por fatura entre rodadas sobrepostas no Panorama
**Contexto:** usuário reportou (com prints reais) que rodar o mesmo período mais de uma vez
fazia o total do Panorama crescer a cada rodada nova — 3 rodadas do período 01–19/07
somavam 3x o valor de uma fatura só. Causa raiz: `buildOverview` somava
`RevenueCategorizedLine.valorRecebidoCat` de TODAS as linhas de TODAS as rodadas concluídas
na janela, sem levar em conta que a MESMA fatura (`crConexaId`) pode existir em várias
rodadas — cada rodada é um snapshot histórico independente e completo, não um delta.
**Decisão (v1):** `linhasDeduplicadasPorFatura()` em `src/lib/reports/overview.ts` usa SQL raw
(Postgres `DISTINCT ON`, via `prisma.$queryRaw`) para escolher, por `crConexaId`, a rodada
CONCLUÍDA mais recente e trazer TODAS as linhas dessa fatura NAQUELA rodada (preserva o
rateio entre categorias de faturas `Proporcionado: S`). Índice novo `@@index([crConexaId])`.

**Correção v2, depois de verificação adversarial (2026-07-21, 3 revisores independentes):**
a v1 tinha dois bugs reais, ambos corrigidos antes do commit:
1. **CRÍTICO — ignorava revisão manual.** O critério "rodada mais recente vence" não
   considerava `revisadoManualmente`. Como toda rodada NOVA sempre recomeça com
   `revisadoManualmente=false` para todas as faturas (a engine não conhece correções
   manuais feitas em rodadas antigas), qualquer reprocessamento do período — mesmo por
   motivo TOTALMENTE não relacionado (ex.: cadastrar categoria de outro serviço) — revertia
   silenciosamente uma correção humana no Panorama, violando diretamente
   financial-rigor.md #9/ADR-0010. **Corrigido:** o `ORDER BY` da escolha do vencedor agora
   prioriza `revisadoManualmente DESC` acima de tudo, com `revisadoEm DESC` como desempate
   entre revisões — revisão manual só perde para outra revisão manual mais recente, nunca
   para uma rodada não-revisada, por mais nova que seja.
2. **MODERADO — vencedor escopado à janela de data, não global.** A v1 filtrava por
   `dataCredito` DENTRO da CTE, antes do `DISTINCT ON` escolher o vencedor — ou seja, a
   "disputa" só via candidatas cujo `dataCredito` já caía na janela consultada. Se o
   `dataCredito` de uma fatura mudasse entre duas rodadas (Conexa é um sistema vivo — já
   documentado como possível), o Panorama de um período podia escolher uma versão
   desatualizada (porque a versão nova, com outro `dataCredito`, ficava fora daquela janela
   e nem entrava na disputa), enquanto OUTRO período escolhia a versão nova — a mesma
   fatura contada em dois painéis de período diferentes ao mesmo tempo. **Corrigido:** o
   vencedor por fatura agora é escolhido GLOBALMENTE (sem filtro de data nenhum na CTE); o
   filtro de `dataCredito` só entra DEPOIS, no SELECT externo, sobre a versão já vencedora —
   garantindo que cada fatura pertença a exatamente um período, seja qual for a janela
   consultada.
**Validado** (via SQL direto + a aplicação real) contra os dados já duplicados no banco
local: (a) nenhuma fatura fica com linhas de DUAS rodadas ao mesmo tempo; (b) uma linha
marcada `revisadoManualmente` numa rodada ANTIGA venceu sobre a versão não-revisada de uma
rodada mais NOVA, e o rótulo revisado apareceu corretamente na tela; (c) o total deduplicado
ficou diferente do de qualquer rodada individual isolada — não por bug, mas porque o rateio
de algumas faturas mudou entre duas coletas ao vivo do Conexa (~1h30 de intervalo).
**Escopo da correção:** só agregações CROSS-rodada (Panorama). `/runs/[id]` e o export de
uma rodada específica continuam mostrando os números que ELA calculou — são o registro
histórico daquela execução, correto por definição, não uma agregação a deduplicar.
**Riscos em aberto, não resolvidos aqui:**
- **Faturas "canceladas" ficam presas para sempre.** Se uma fatura sai da lista aceita do
  Conexa entre duas coletas (ex.: cancelamento) e a rodada nova simplesmente não a inclui
  mais, o `DISTINCT ON` não tem como perceber isso — a versão antiga (única candidata
  remanescente) segue vencendo indefinidamente. Não há hoje um mecanismo de "tombstone"
  para faturas que desapareceram. Achado pela verificação adversarial, não corrigido nesta
  sessão — fica documentado como limitação conhecida.
- **Custo de performance:** a escolha do vencedor agora escaneia TODAS as rodadas
  concluídas do sistema (não só a janela), para garantir corretude global. Aceitável no
  volume atual; precisa ser revisitado se o volume de rodadas crescer muito (ver próximo
  ponto).
- Cada rodada nova (mesmo de um período repetido) cria linhas NOVAS — nada é substituído
  nem limpo. Se o sistema passar a rodar automaticamente em intervalos curtos (ex.: a cada
  15 min, intenção verbalizada pelo usuário), o volume de `RevenueCategorizedLine` cresce
  sem limite e sem nunca purgar as linhas de rodadas já superadas — e o custo de performance
  acima piora com o tempo. Esta ADR resolve a CORREÇÃO dos números exibidos, não o
  crescimento de dados — ver conversa em aberto no progress.md sobre a arquitetura do
  agendador automático (append-only + faxina periódica vs. modelo upsert-por-fatura).
- Sem teste automatizado cobrindo `linhasDeduplicadasPorFatura` (requer banco real — não há
  hoje infraestrutura de teste de integração no projeto). A cobertura até aqui é validação
  manual empírica contra dado real, repetida a cada mudança nesta função.

**Superada pela ADR-0013** — a deduplicação por leitura (`linhasDeduplicadasPorFatura`) foi
removida; a garantia de "uma fatura conta uma vez só" passou a vir do MODELO DE DADOS
(upsert por fatura), não de uma query especial no Panorama. Fica registrada aqui como
histórico do raciocínio e da verificação adversarial que a originou.

## ADR-0013 — Upsert por fatura + sincronização automática de 15 minutos
**Contexto:** ao investigar a causa raiz do bug da ADR-0012, o usuário revelou a intenção
real do sistema: rodar a sincronização AUTOMATICAMENTE a cada 15 minutos, mantendo os dados
sempre atualizados. O modelo append-only (cada rodada cria um conjunto novo e imutável de
`RevenueCategorizedLine`) não sustenta essa cadência — cresce sem limite (dezenas de
milhares de linhas/dia) e a deduplicação por leitura da ADR-0012 (uma varredura global sem
filtro de data) fica mais cara a cada dia. Perguntado, o usuário escolheu explicitamente:
(1) modelo de dados — **upsert por fatura** (mais próximo do sync do projeto irmão), em vez
de append-only + faxina periódica; (2) janela da sincronização automática — **mês corrente**
(dia 1 até agora) a cada execução.
**Decisão:**
1. **`RevenueCategorizedLine.chaveLinha`** — identidade estável de um bucket de categoria
   dentro de uma fatura (`chaveLinhaDoBucket()` em `categorize-invoices.ts`: a categoria que
   a SKILL calculou, ou `"Sem Categoria::"+nome` quando não mapeado), persistida uma vez e
   NUNCA recalculada depois — mesmo que uma revisão manual reescreva `categoria`. Chave de
   unicidade `@@unique([crConexaId, chaveLinha])`: cada bucket tem UMA linha atual.
2. **`RevenueCategorizationRun` renomeada para `RevenueSyncRun`** — deixa de ser dona
   exclusiva de suas linhas (`onDelete: Cascade` → `ultimaRodadaId`/`onDelete: Restrict`) e
   passa a ser só um log de execução; `totalRecebido`/`resumoPorCategoria` continuam sendo o
   snapshot histórico do que ESSA rodada calculou no momento, nunca recalculado depois (nem
   por uma revisão manual posterior — diferente do comportamento antigo de
   `updateCategorizedLineAction`, que recalculava o resumo da rodada dona da linha; esse
   conceito deixou de existir).
3. **`persistLinhasCategorizadas()`** (`src/lib/categorization/persist.ts`) substitui o
   `createMany` por um `upsert` (Prisma nativo, não SQL cru) por `(crConexaId, chaveLinha)`
   a cada rodada. Protege a revisão manual (financial-rigor.md #9): quando a linha existente
   já está `revisadoManualmente`, `categoria`/`valorRecebidoCat` são passados como
   `undefined` no `update` (Prisma ignora chaves `undefined` — equivalente a omiti-las); todo
   o resto (datas, status, `raw` — dados factuais do Conexa, não decisões da skill) continua
   atualizando normalmente.
4. **Linhas órfãs.** Uma linha existente cujo `(crConexaId, chaveLinha)` não aparece mais no
   resultado de uma rodada (a composição de itens mudou, ou uma categoria "adivinhada"
   manualmente passou a ter regra de verdade) é apagada — EXCETO se `revisadoManualmente`,
   caso em que é preservada e contada em `totalLinhasOrfasPreservadas` (nunca some
   silenciosamente — regra #8). Sem UI de remediação dedicada por ora; a contagem no resumo
   da rodada é o sinal.
5. **`startCategorizationRun` nunca roda em paralelo** — se já existe uma `RevenueSyncRun`
   com `status = RUNNING`, lança `SincronizacaoEmAndamentoError` em vez de competir por
   escrita nas mesmas linhas (protege tanto o agendador colidindo com um disparo manual,
   quanto múltiplas réplicas do container).
6. **Agendador em processo** (`src/lib/scheduler/auto-sync.ts` + `src/instrumentation.ts`,
   hook padrão do Next.js 15 — roda uma vez quando o servidor sobe, inclusive no modo
   standalone do Docker, nunca durante `next build`): dispara um tick imediato no boot e
   depois se reagenda via `setTimeout`, sempre só APÓS o tick anterior terminar — nunca
   sobrepõe uma sincronização à outra. `SYNC_AUTO_ENABLED` (default `true`) e
   `SYNC_INTERVAL_MINUTES` (default `15`) controlam o comportamento; desligado no `.env`
   local para não logar de verdade no Conexa durante o desenvolvimento.
7. **`overview.ts` simplificado** — como só existe UMA linha por bucket a qualquer momento,
   `linhasDeduplicadasPorFatura` (SQL cru, `DISTINCT ON`, ADR-0012) foi removida; o Panorama
   agora é um `findMany` direto filtrado por `dataCredito`.
8. **Nova tela `/revisar`** — com sync a cada 15 min, uma revisão presa a "a última rodada
   que toquei" esvazia com o tempo (`/runs/[id]` só mostra o que aquela rodada tocou por
   último). `/revisar` é a fila de trabalho GLOBAL e sempre atual: todas as linhas
   `Proporcionado IN (S, SEM_LV)` do sistema, não-revisadas primeiro.
**Migração de dados:** já havia dado de teste real no banco local (1718 linhas, 2 rodadas
sobrepostas) — sem dado de produção real ainda (Easypanel não configurado). A migração
(`20260721193000_upsert_por_fatura`) faz backfill de `chaveLinha` a partir de
`COALESCE(categoriaOriginal, categoria)` (usa o valor que a SKILL calculou, não uma
categoria já sobrescrita por revisão manual) e deduplica linhas existentes por
`(crConexaId, chaveLinha)` com a MESMA prioridade da ADR-0012 antes de criar a constraint
única — reduziu para 886 linhas / 684 faturas distintas, batendo com o número de faturas já
validado em sessões anteriores. Escrita de forma genérica (não um "wipe"), para documentar o
comportamento correto quando isso rodar contra dado real.
**Correções pós-verificação adversarial (2026-07-21, 3 revisores + 1 verificador por achado,
antes de shippar):** dado o risco financeiro, rodei uma verificação adversarial contra a v1
desta mudança — achou 10 problemas reais confirmados (de 11 levantados), todos corrigidos
antes do commit:
- **CRÍTICO — TOCTOU entre a proteção de revisão manual e uma sincronização em andamento.**
  A v1 de `persistLinhasCategorizadas` lia `revisadoManualmente` numa query separada e só
  decidia/gravava depois — uma revisão manual feita bem NESSA janela podia ser silenciosamente
  sobrescrita (ou, numa linha órfã, até apagada). **Corrigido:** toda a função (leitura,
  delete de órfãs, upserts) roda numa ÚNICA transação Serializable, e
  `updateCategorizedLineAction` também passou a ser Serializable — só assim o Postgres detecta
  o conflito (P2034) e aborta uma das duas, em vez de deixar a mais lenta sobrescrever
  silenciosamente a mais rápida. Ver financial-rigor.md #11.
- **CRÍTICO — `chaveLinha` instável pode causar dupla contagem.** Uma linha revisada
  manualmente cujo bucket "sem categoria" ganha depois uma regra de verdade gera, na próxima
  rodada, um bucket NOVO (chaveLinha diferente) — a linha antiga (preservada, nunca apagada)
  e a nova (correta) juntas contam a mesma receita duas vezes. Não é auto-corrigível sem um
  humano decidir qual versão vale. **Mitigado (não eliminado):** nova conferência por fatura em
  `persistLinhasCategorizadas` — soma das linhas atuais vs. valor total da fatura — sinaliza via
  `RevenueSyncRun.totalFaturasComConflito` (nunca silencioso) e um alerta visível em
  `/runs/[id]`. Ver financial-rigor.md #11.
- **CRÍTICO — fuso horário aplicado duas vezes em `computeAutoSyncWindow()`.** No caminho de
  produção (sem `referencia` explícita), o resultado já-fusado de `nowInAppTz()` era
  repassado para `getPeriodBounds()`, que fusa de novo — durante as primeiras ~3h de todo mês
  (fuso America/Fortaleza, UTC-3), a janela "mês corrente" regredia para o mês anterior
  inteiro. **Corrigido:** quando não há `referencia`, chama `getPeriodBounds("month")` SEM
  segundo argumento (ele mesmo chama `nowInAppTz()` uma única vez). Regressão coberta por
  teste com fake timers (`auto-sync.test.ts`).
- **CRÍTICO — exceção não tratada podia derrubar o processo no boot.** `computeAutoSyncWindow()`
  era chamada FORA do try/catch de `runAutoSyncTick`; se lançasse (ex.: `APP_TIMEZONE`
  malconfigurado), a rejeição escapava da cadeia `.finally()` do agendador como unhandled
  rejection — no Node ≥15 isso derruba o processo, inclusive no tick imediato do boot.
  **Corrigido:** chamada movida para dentro do try.
- **MODERADO — `scheduleAutoSync()` podia impedir o servidor inteiro de subir.** Chamava
  `getEnv()` (valida TODAS as variáveis, não só as de sync) sem try/catch dentro de
  `instrumentation.ts::register()` — uma variável não relacionada malconfigurada (ex.
  `SESSION_SECRET` curto) travava `prepare()` do Next.js para SEMPRE, derrubando toda
  requisição, não só a sincronização. **Corrigido:** `register()` isola essa chamada num
  try/catch — pior caso agora é subir sem sincronização automática, nunca sem servidor.
- **MODERADO — rodada travada bloqueava sincronizações para sempre.** O guard "já existe
  RUNNING" não tinha recuperação: se o processo morresse no meio de uma rodada, ela ficava
  RUNNING permanentemente, e toda sincronização futura (automática e manual) era bloqueada
  para sempre. **Corrigido:** `RODADA_TRAVADA_MS` (30 min) — uma RUNNING mais velha que isso
  é marcada FAILED automaticamente antes de liberar a nova.
- **MODERADO — delete de órfãs e upserts em transações separadas.** Um crash entre as duas
  podia deixar um estado inconsistente (órfã já apagada, linha nova ainda não gravada).
  Resolvido de graça pela mesma correção do TOCTOU acima (tudo numa única transação).
- **MENOR — documentação desatualizada.** financial-rigor.md regra #9(b) ainda descrevia o
  recálculo de `resumoPorCategoria`/`totalRecebido` "da rodada dona da linha" — comportamento
  intencionalmente removido por esta ADR. Corrigido o texto da regra #9.
**Riscos aceitos, não resolvidos aqui:**
- Tombstone de fatura cancelada/estornada continua em aberto (mesma limitação da ADR-0012 —
  não resolvida, só não piorada).
- Lock entre múltiplas réplicas do container é só o guard "já existe RUNNING" — suficiente
  para o deploy de réplica única já decidido, não um lock distribuído de verdade.
- `persistLinhasCategorizadas` usa upserts em série via Prisma (não SQL em lote) — aceitável
  no volume atual (~700 faturas), revisitar se crescer muito. Agora roda dentro de uma
  transação Serializable de duração mais longa (proporcional ao nº de faturas) — aceitável na
  escala atual, mas revisitar junto com o ponto anterior se o volume crescer muito.
- O conflito de fatura (`totalFaturasComConflito`) é detectado e sinalizado, mas não tem tela
  de remediação dedicada — resolver hoje exige acesso direto ao banco para decidir qual linha
  é a correta.
**Status:** aceito.
