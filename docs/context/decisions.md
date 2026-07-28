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
  não resolvida, só não piorada). **[RESOLVIDO 2026-07-24, ver ADR-0020]**
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

## ADR-0014 — Cadastrar categoria não recategoriza o passado: "Aplicar agora" re-sincroniza
**Contexto:** usuário reportou que a Duda (conta dela, ADMIN confirmado por print de
`/contas`) clicava em "Categorizar" numa pendência de `/categorias` e "nada acontecia",
enquanto para ele "dava certo" — o item sumia da lista. Primeira hipótese (papel VIEWER) foi
levantada e REFUTADA pelo próprio usuário antes de virar código. Causa raiz real: o clique
sempre funcionou; `createCategoryRuleAction` grava em `RevenueCategoryRule`, mas a lista de
pendências lê `RevenueCategorizedLine` — só uma sincronização transporta a regra de uma
tabela para a outra, e `computeAutoSyncWindow()` cobre APENAS o mês corrente. Logo, o
resultado visível dependia de algo que a tela nunca mostrou: a data das faturas. Item só com
linhas do mês corrente sumia no tick seguinte (≤15 min); item com linhas de meses anteriores
ficava preso na lista para sempre. Confirmado com dado real: das linhas "Sem Categoria" do
banco de dev, 4 de 27 estão fora do mês corrente, e "Cliente Avulso" tem faturas espalhadas
de 2025-08 a 2026-07 — cadastrar a categoria dele faria as de julho sumirem e as de 2025
permanecerem, mantendo o item na tela com a mesma aparência.
**Decisão:** `createCategoryRuleAction` passa a retornar `CategoryRuleState` (era `void`),
confirmando o que foi salvo e devolvendo `pendentes` — quantas faturas já persistidas
continuam "Sem Categoria" com aquele nome e o intervalo mínimo de `dataCredito` que as
cobre. A UI oferece "Aplicar agora", que dispara `triggerRunAction` para EXATAMENTE esse
período. Re-sincronizar em vez de dar `UPDATE` direto nas linhas é deliberado: uma linha que
muda de categoria pode precisar ser FUNDIDA com outra linha da mesma fatura que já tem essa
categoria, com o rateio proporcional refeito (`chaveLinhaDoBucket`/`allocateProportionally`)
— o motor de categorização já faz isso corretamente, um `UPDATE` cru distorceria a fatura.
Quando o período passa de 2 meses a UI avisa que o reprocessamento pode demorar. O texto da
página, que prometia "a próxima sincronização que encontrar o mesmo nome já vem
categorizada" (falso para meses anteriores), foi corrigido.
**Riscos aceitos:** "Aplicar agora" pode disparar um reprocessamento longo (ex.: 12 meses
para "Cliente Avulso") — mitigado só por aviso na tela, não por execução incremental. O
período sugerido cobre o intervalo inteiro entre a fatura mais antiga e a mais nova, mesmo
que os meses do meio não tenham pendência daquele nome.
**Status:** aceito.

## ADR-0015 — Categoria vira lista com opção de digitar; guardas de ADMIN e checkRole
**Contexto:** (a) os campos de categoria eram texto livre em todo lugar, e como os relatórios
agrupam por string exata, qualquer variante ("Serviços de Espaço " com espaço sobrando)
viraria uma categoria separada no Panorama; (b) auditoria de permissões durante a
investigação da ADR-0014 encontrou que criar/renomear/desativar regra de categorização e
disparar sincronização exigiam apenas `requireUser()`, contrariando o comentário do enum
`UserRole` em schema.prisma ("ADMIN gerencia tabela de categorias, dispara rodadas") — um
VIEWER podia reescrever a tabela que rege toda a receita, sem rastro de autoria, e disparar
rodadas que REESCREVEM linhas já persistidas (ADR-0013).
**Decisão:** `CategoriaField` (`src/components/categoria-field.tsx`) usa `<select>` NATIVO
com as categorias já conhecidas (`listCategoriasConhecidas()` une regras ativas + categorias
já gravadas em linhas, para incluir as que vêm dos fallbacks fixos de rules.ts) mais uma
opção "Outra… (digitar)" que desmonta o select e monta um `<input>` com o mesmo `name` — só
um dos dois existe no DOM por vez, então nunca há dois valores concorrendo no submit. Nativo
em vez de combobox próprio: já traz navegação por teclado, busca por digitação e suporte a
leitor de tela. Valor fora da lista abre direto em modo texto, senão o select trocaria
silenciosamente a categoria de uma linha ao salvar. Guardas: as actions de regra e de
sincronização passam a exigir ADMIN, e `POST /api/runs` responde 403 em JSON.
**Decisão de suporte — `checkRole()` (`src/lib/auth/session.ts`):** `requireRole()` usa
`redirect()`, correto para PÁGINA e errado dentro de Server Action — `redirect()` lança
`NEXT_REDIRECT`, a action nunca retorna seu estado, e o formulário fica sem `error`/`ok` para
renderizar: a pessoa clica em salvar, é jogada para outra tela e nada explica o porquê.
Exatamente a classe de sintoma investigada na ADR-0014. `checkRole()` devolve
`{ok, user} | {ok:false, error}` para a UI mostrar. Aplicado nas actions de categorização e
nas quatro actions de conta que tinham o mesmo defeito.
**Riscos aceitos:** `listCategoriasConhecidas()` roda uma query a mais por página que usa o
campo (aceitável no volume atual, ~15 categorias distintas); a lista não tem paginação nem
busca própria além da busca nativa do `<select>`.
**Status:** aceito.

## ADR-0016 — Metas de receita por escopo, mensais, exibidas no Panorama
**Contexto:** pedido do usuário — "visualização de METAS" no Panorama, começando pelos
serviços de espaço (Seaway, Sebrae, Ayrton Senna), com campo de configuração para admin e
exibição da meta + percentual atingido, usando Data de Crédito como base. Decisões de produto
tomadas pelo usuário nesta sessão: (a) escopo = SÓ as categorias "Serviços de Espaço - X",
não a unidade inteira (as "Salas Privativas - X" das mesmas unidades, 4-12x maiores, ficam de
fora); (b) meta mensal, com períodos maiores somando os meses; (c) exibir percentual da meta
cheia mais um marcador de ritmo esperado.

**Decisão — modelo em três tabelas + log** (`MetaEscopo` → `MetaEscopoCategoria` →
`MetaPeriodo`, mais `MetaPeriodoEvent`). A meta NUNCA é amarrada a uma string de categoria:
o escopo tem identidade estável (`slug`) e lista N categorias. Isso resolve de uma vez duas
coisas — trocar o recorte (incluir "Salas Privativas" depois) vira linha filha em vez de
migração, e o split de grafia da ADR-0017 é absorvido cadastrando as DUAS grafias no mesmo
escopo desde o dia 1.

**Decisão — granularidade única (mês), sem enum de período.** Verificado no código:
`getPeriodBounds("quarter","2026-07-01").fromKey` e `getPeriodBounds("month","2026-07-01").fromKey`
produzem A MESMA string ("2026-07-01"), e "2026-01-01" é simultaneamente chave de ano, de 1º
trimestre e de janeiro (src/lib/dates.ts). Um schema `(periodoKind, periodoKey)` com resolver
por soma dobraria a meta silenciosamente. Mês é o átomo; trimestre/semestre/ano são a SOMA dos
meses contidos, calculada na leitura (`mesesDoPeriodo`, coberto por 15 testes justamente
porque um mês a mais/a menos infla ou desinfla a meta sem dar erro visível).

**Decisão — dia e semana não exibem meta.** Ratear meta mensal por dias assumiria receita
uniforme, e `dataCredito` concentra nas datas de vencimento — o número pareceria apurado e
seria inventado. O card explica e linka para a visão mensal. Note que `PeriodKind` tem SEIS
valores (inclui "day"), não cinco.

**Decisão — meta parcial recorta o realizado.** Quando só parte dos meses do período tem meta,
o realizado exibido é restrito EXATAMENTE aos mesmos meses, com aviso na tela. Dividir 3 meses
de receita por 1 mês de meta produziria "300% da meta" com aparência de número apurado.

**Decisão — `realizado` e `%` nunca são persistidos**, sempre calculados ao vivo das linhas
atuais. Persistir repetiria o erro que a ADR-0013 corrigiu (resumo congelado divergindo das
linhas após revisão manual), agravado pela sincronização automática de 15 min.

**Decisão — input numérico, não parser de moeda pt-BR.** Verificado com o Decimal real do
projeto: um parser que só trata pt-BR quando há vírgula converte "25.000" (o jeito natural de
escrever meta redonda) em **25**, silenciosamente e sem erro. `<input type="number" step="0.01">`
elimina a classe inteira do problema, e é o padrão já usado em linha-revisao-row.tsx.

**Decisão — /metas é página própria no padrão /categorias** (visível a todos, escrita
protegida por `checkRole("ADMIN")` na action), não dentro de /contas, que é sobre usuários e
acessos. Quem vê a meta no Panorama consegue conferir de onde ela saiu.

**Bugs encontrados pelo smoke test com dado real** (typecheck e 79 testes passavam):
 1. No modo mensal aparecia "Nem todos os 1 meses deste período têm meta definida" — a lógica
    tratava "escopo sem meta nenhuma" (Ayrton Senna) como "mês sem meta". Mensagem falsa.
 2. Percentuais renderizavam "91.5%" (ponto, convenção inglesa). Criado `formatPercent()` em
    money.ts e aplicado também no KPI "Sem categoria", que tinha o mesmo defeito — senão a
    mesma tela mostraria "91,5%" e "6.1%" lado a lado.

**Riscos aceitos / fora desta versão:**
- O marcador de ritmo é LINEAR (fração de dias decorridos) e rotulado como referência, não
  previsão. A crítica adversarial defendeu usar o realizado do mesmo dia-do-mês em meses
  anteriores (dado apurado em vez de reta); rejeitado por ora porque o histórico do banco é
  quase todo de um mês só — voltaria a servir só em 2027. Decisão do usuário.
- Gerenciar as categorias de um escopo pela UI ficou de fora (o schema suporta; hoje vem do
  seed). Adicionar/remover categoria exige `npm run db:seed-metas` ou SQL.
- Metas de escopos diferentes NUNCA podem ser somadas entre si se um dia existirem escopos
  sobrepostos (ex.: "espaco-seaway" e "unidade-seaway") — hoje não existem, e o teste
  `escopos.test.ts` falha se alguma categoria aparecer em dois escopos.
- Ayrton Senna ficou deliberadamente SEM meta (fatura R$ 0,00 nessa categoria) — um card
  cronicamente em 0% vira ruído que o time aprende a ignorar.
**Status:** aceito.

## ADR-0017 — Split de grafia: duas variantes vivas da mesma categoria (conhecido, NÃO resolvido)
**Contexto:** descoberto ao implementar as metas (ADR-0016). Existem hoje DUAS grafias da
mesma categoria, geradas por caminhos diferentes do próprio sistema:

| | `RevenueCategoryRule` (regras) | `RevenueCategorizedLine` (linhas) |
|---|---|---|
| Sebrae | `"Serviços de Espaço - Sebrae"` (1 espaço) | `"Serviços de Espaço -  Sebrae"` (2 espaços) |
| Ayrton Senna | `"Serviços de Espaço - Ayrton Senna"` (1) | `"Serviços de Espaço -  Ayrton Senna"` (2) |

Origem: `prisma/seeds/categorizacao-inicial.csv` tem DOIS espaços, mas
`scripts/seed-categories.mjs:57` aplica `normalize()` (trim + colapso) TAMBÉM na coluna
categoria, gravando UM espaço nas regras; `src/lib/categorization/rules.ts` FIXED_FALLBACKS
tem DOIS espaços hardcoded e é quem produz a categoria das linhas. Seaway não tem split (CSV e
fallback concordam em um espaço).

**Impacto latente:** hoje todas as linhas de Sebrae/Ayrton vieram do fallback, então só a
grafia de dois espaços aparece nas linhas. Mas regra exata tem prioridade sobre fallback
(rules.ts): **basta alguém cadastrar uma regra para um serviço "[SEBRAE] -" em /categorias**
para a variante de um espaço começar a ser gravada, e a receita da unidade passar a se partir
em duas categorias distintas no Panorama, que agrupa por string exata.

**Decisão:** NÃO corrigir agora — decisão explícita do usuário nesta sessão. Unificar as
grafias exige escolher a canônica (afeta as planilhas que a Duda usa) e atualizar linhas
financeiras já gravadas, com backup. As metas foram desenhadas para serem IMUNES ao split
(ADR-0016: o escopo soma as duas grafias), então a feature não fica bloqueada.
**Blindagem colocada:** `src/lib/metas/escopos.test.ts` trava os três literais de fallback com
strings HARDCODED — nunca importadas de `escopos.ts` nem de `rules.ts`. Um teste que lê a
constante que pretende proteger é tautológico: quem "arrumar" o espaçamento editaria a
constante, os dois lados mudariam juntos e o teste seguiria verde enquanto a meta parava de
casar com as linhas gravadas.
**Pendente:** decidir a grafia canônica com a Duda e migrar as linhas existentes.
**Status:** conhecido, contornado, não resolvido.

## ADR-0018 — Porta exata de categoriza_receita.py, linha por linha
**Contexto:** o usuário pediu para investigar se o motor de categorização (portado para TS numa
sessão anterior a partir só do SKILL.md — texto de orquestração, sem o código-fonte real) batia
EXATAMENTE com a lógica do script Python original (categoriza_receita.py). O script nunca tinha
sido fornecido ao projeto; a porta original foi uma reconstrução a partir de prosa. O usuário
depois obteve o .py real de dentro do container OpenClaw na VPS (docker cp) e pediu paridade
total: "quero tudo exatamente como o Openclaw executa. Duda já validou isso usando o OC, e foi
isso que nos fez construir esse sistema de dashboard."

**Método:** comparação linha a linha do .py real contra rules.ts/join.ts/categorize-invoices.ts/
types.ts/parse-exports.ts/seed-categories.mjs, cada divergência verificada contra os exports
reais do Conexa (não só fixtures) antes de decidir o que corrigir.

**Divergências confirmadas e corrigidas:**

1. Normalização de nome/categoria. O Python faz só str(x).strip() — nunca lowercase, nunca
   colapsa espaço interno duplo. Uma normalização anterior em rules.ts era mais tolerante
   (trim + colapso de espaço + lowercase), casando nomes que o Python deixaria cair para um
   prefixo mais curto ou "Sem Categoria". Corrigido: case-sensitive, preserva espaço interno.

2. Sufixo "(SEAHUB COWORKING)"/"(SEATECH)" com periodicidade OPCIONAL no regex real — uma
   versão anterior exigia a palavra Mensal/Anual/Bianual. Verificado contra a Listar Vendas
   real: 122 de 272 nomes distintos de serviço têm sufixo sem periodicidade — mas o impacto
   prático na categoria final é pequeno, já que "maior prefixo" absorve a maioria desses casos.
   Corrigido mesmo assim, para bater exatamente.

3. "Maior prefixo": trocado o pré-sort por comprimento (dependia de estabilidade de sort e
   ordem de chegada do array) pelo loop incremental do Python (comparação ESTRITA de
   comprimento) — mesmo efeito, mas replicando o mecanismo real. run.ts ganhou
   orderBy: {id:"asc"} na busca das regras, aproximação razoável de "ordem do arquivo" (cuid é
   cronológico; não é garantia formal sem uma coluna de ordem explícita — risco residual aceito).

4. Join CR×LV sem exclusividade entre faturas concorrentes. O Python NÃO reserva itens da
   Listar Vendas já usados por uma fatura anterior que compartilha (cliente, mês) — cada fatura
   tenta o desempate por valor independentemente contra o MESMO grupo compartilhado, e se não
   resolver para exatamente 1 item, usa o GRUPO INTEIRO — nunca cai para "Sem LV" por
   ambiguidade. Uma versão anterior de join.ts adicionava exclusividade como salvaguarda contra
   dupla atribuição — mais conservadora que o original, mas divergente. Removida. Tolerância do
   desempate corrigida de <=0,02 para <0,02 (estrita, como o Python).

5. Agrupamento de "Sem Categoria" por fatura. O Python agrupa TODOS os itens de uma fatura pela
   mesma categoria — mesmo quando são serviços "Sem Categoria" DIFERENTES entre si (nomes
   concatenados com "; " numa única linha). Uma versão anterior separava cada serviço não
   mapeado em uma linha própria, pensada para auditoria em /categorias, mas divergente do
   original — inclusive mudava o próprio Proporcionado (Python conta "N" quando só há 1
   categoria distinta, mesmo com serviços físicos diferentes por trás dela). Corrigido:
   chaveLinhaDoBucket agora é sempre a categoria pura.

6. Arredondamento por ITEM, não por bucket. O Python arredonda o valor de CADA item individual
   da Listar Vendas primeiro (sem correção cruzada), DEPOIS soma os itens já-arredondados por
   categoria, e só então aplica o resíduo de fechamento no ÚLTIMO bucket (ordem de primeira
   aparição). A versão anterior calculava o peso agregado por categoria de uma vez e arredondava
   uma única vez por bucket — podia fechar em valores diferentes por 1 centavo em faturas com
   múltiplos itens na mesma categoria. categorize-invoices.ts reescrito para replicar as duas
   fases exatamente.

7. Filtro de status do CR por SUBSTRING, não lista fechada. Python aceita qualquer status
   contendo "Quitada" OU "Negociação", não só as duas strings exatas do SKILL.md (que era uma
   simplificação da prosa). types.ts ganhou statusAceitoCR() substituindo a lista fechada
   STATUS_ACEITOS_CR. Verificado contra o export real: só existem os dois status exatos hoje
   (divergência latente, não ativa nos dados atuais).

8. Data Crédito: inclui a fatura se QUALQUER data da lista cair no período — decisão de produto
   explícita do usuário, aceitando o trade-off. O Python filtra faturas recorrentes (Data
   Crédito com lista de datas separadas por vírgula) checando se PELO MENOS UMA data cai no
   período — não apenas a primeira, que era o comportamento anterior. Isso ancorava faturas
   parceladas no mês da primeira parcela, mesmo quando o período pedido batia com uma parcela
   posterior — causa raiz confirmada da divergência de R$10.296,11 encontrada 2 sessões atrás
   entre o card "Quitadas" do Conexa e o Panorama. parseDataCreditoNoPeriodo (nova, em
   parse-exports.ts) recebe periodoInicio/periodoFim e escolhe a data da lista que cai no
   período (ou null se nenhuma cair — run.ts usa isso para EXCLUIR a fatura da rodada).
   Trade-off aceito conscientemente: como persistimos só UMA data por linha (upsert por fatura,
   ADR-0013), a MESMA fatura recorrente pode ficar "associada" a meses diferentes ao longo do
   tempo, conforme sincronizações rodem para períodos diferentes e cada uma capture uma data
   distinta da lista da mesma fatura. Isto NÃO é um risco introduzido pela sincronização
   automática de 15 min: é uma propriedade do próprio script — se a Duda rodasse
   categoriza_receita.py duas vezes para períodos sobrepostos, a mesma fatura apareceria inteira
   nas duas planilhas resultado. O usuário decidiu explicitamente replicar isso em vez de manter
   o comportamento anterior (mais estável entre sincronizações, porém divergente do original).

9. Checagem de qualidade da skill, agora automatizada. O SKILL.md exige conferir que a soma de
   "Valor Recebido Cat." bate com a soma de "Valor Recebido" no CR exportado. Não existia
   nenhuma verificação equivalente no pipeline — run.ts agora calcula diferencaConferencia a
   cada rodada, grava no RevenueSyncRun, loga erro no servidor se não fechar, e exibe alerta em
   /runs/[id] no mesmo padrão visual de totalFaturasComConflito.

**Correção de dado já persistido:** scripts/fix-categorias-espacamento.mjs (novo, standalone,
não roda no boot) corrige RevenueCategoryRule.nome/categoria para linhas que a versão antiga
(com bug) do seed colapsou espaço interno duplo — 74 regras no banco de dev (Ayrton
Senna/Sebrae, "Serviços de Espaço" e "Salas Privativas", mais ~10 nomes com espaço duplo antes
do hífen). IDEMPOTENTE e conservador: só corrige uma linha se o valor ATUAL bate EXATAMENTE com
o que o bug de colapso produziria a partir do CSV — qualquer outro valor atual (inclusive uma
correção manual real feita via /categorias) fica intocado e é reportado como "sem ação". Rodado
e verificado contra o banco de dev (74 corrigidas, 0 casos ambíguos); pendente rodar contra
produção.

**Removido:** src/lib/categorization/rateio.ts (allocateProportionally) e seu teste — o
algoritmo (resíduo no último peso agregado) não corresponde ao que o script real faz (resíduo
no último BUCKET, após soma de itens já-arredondados individualmente, ver achado 6). Ficou sem
uso depois da reescrita de categorize-invoices.ts; removido por instrução explícita do usuário.

**Validado contra dado real (não só fixtures), em cada etapa:**
- 102 testes unitários (12 novos cobrindo especificamente lista de datas em Data Crédito).
- Motor completo rodado contra o export real do Conexa (01/07-22/07/2026) com as regras
  corrigidas: Sebrae/Ayrton Senna aparecem com espaço duplo; conferência fecha exata ao centavo
  (diferencaConferencia = 0); as 4 faturas parceladas identificadas na sessão anterior como
  "vazadas" de julho agora ancoram em datas de julho; o total recuperado
  (R$273.428,98 - R$263.132,87 = R$10.296,11) bate exatamente com a estimativa de vazamento
  daquela investigação.
- Sincronização real ponta a ponta via API (login no Conexa, download, categorização,
  persistência): 743 faturas CR, 0 conflitos, 0 órfãs, diferencaConferencia = 0.

**Riscos aceitos, documentados:**
- Trade-off de Data Crédito (achado 8) — decisão de produto explícita, não um bug.
- Ordem de desempate de "maior prefixo" depende de orderBy: {id:"asc"} como proxy de "ordem do
  arquivo" — não é garantia formal (achado 3).
- Filtro de status do CR por substring (achado 7) é mais permissivo que a lista fechada
  anterior — não observado ativo no dado atual, mas pode aceitar status não previstos no futuro.
- fix-categorias-espacamento.mjs ainda não rodou em produção.
**Status:** aceito.

## ADR-0019 — Auditoria multi-agente pós-ADR-0018: 10 divergências/riscos confirmados, 6 corrigidos

**Contexto:** o usuário pediu para "estudar a fundo" o funcionamento da skill (o .py real,
baixado em sessão anterior), o port TS e a arquitetura de sincronização já construída, e corrigir
o que fosse encontrado — objetivo explícito: "um sistema estável e confiável". Motivado também
por uma investigação de reconciliação (Conexa "Quitadas" R$388.368,37 vs nosso Total Recebido
R$279.852,89 no mesmo período/campo): confirmado por fetch direto ao Conexa que **não há bug** —
o Conexa soma Valor Bruto (inflado por contratos anuais) nessa tela, nosso Valor Recebido bate
exato fatura a fatura contra o export cru.

**Método:** workflow de 6 agentes em paralelo, cada um relendo o `.py` inteiro (511 linhas) e uma
fatia do TS (matching de categoria, join CR×LV, rateio/arredondamento, filtros de status/data,
arquitetura de sync/persist, precisão numérica), seguido de uma verificação ADVERSARIAL
independente por achado (agente instruído a tentar REFUTAR, não confirmar) antes de qualquer
correção ser aplicada. 12 achados candidatos → 10 confirmados, 2 refutados.

**Corrigidos nesta sessão (bugs claros, sem trade-off de produto):**

1. `normalizeRuleName()` (actions.ts) colapsava espaço interno duplo ao cadastrar/editar regra
   via UI — o Python só faz `.strip()`. Quebrava silenciosamente o cadastro de regras para nomes
   com espaço duplo real (padrão Sebrae/Ayrton Senna, mesma classe de bug do ADR-0017, só que
   nesta função específica ninguém tinha corrigido ainda). Corrigido para `nome.trim()`.

2. `bucket.nomes` (categorize-invoices.ts) deduplicava nomes de serviço idênticos dentro do
   mesmo bucket — o Python concatena TODOS os itens, mesmo repetidos (`"; ".join(...)` sem
   filtro). Não afeta o valor (a soma do bucket é independente do array de nomes), só o texto
   auditável em `servicoOuPlano`. Corrigido: sempre concatena, sem dedup.

3. `parseFlexibleDate` (parse-exports.ts) só cortava por ESPAÇO (pra remover hora), nunca por
   VÍRGULA — o Python (`norm_comp`/`parse_date`) sempre corta por vírgula primeiro. Risco latente
   para Competência/Referência Cobrança, caso algum dia venham como lista (Data Crédito já
   demonstrou ter esse formato). Corrigido: corta por vírgula antes de espaço.

4. Mesma função: exigia exatamente 2 dígitos para dia/mês (`\d{2}`), mas o `strptime` do Python
   aceita 1 ou 2 (`"1/7/2026"` parseia normalmente). Sem evidência de ter ocorrido em export
   real, mas fecha uma lacuna de aceitação de formato. Corrigido para `\d{1,2}`.

5. **Export `/api/runs/[id]/export` ficava vazio para qualquer rodada que não fosse a mais
   recente** (achado próprio, fora do workflow) — a query filtrava por `ultimaRodadaId`, que o
   auto-sync (a cada 15 min, sempre reprocessando o mesmo período) recarimba em TODAS as linhas
   a cada tick. Corrigido: filtra por `dataCredito` dentro do período da própria rodada, que é o
   que o comentário do arquivo já dizia pretender.

6. **Concorrência entre sincronizações** — o guard de "rodada travada" (30 min) marca a RUNNING
   antiga como FAILED e libera uma nova, mas nada garantia que a antiga tivesse morrido de
   verdade (fetches ao Conexa não tinham timeout). Duas rodadas podiam persistir o mesmo período
   concorrentemente. Corrigido em duas frentes: `conexa-web/client.ts` ganhou
   `AbortSignal.timeout(90_000)` nos fetches; `persistLinhasCategorizadas` agora rechecka DENTRO
   da própria transação Serializable se a rodada ainda está RUNNING antes de tocar qualquer
   linha (`RodadaSuperadaError` se não estiver — nunca persiste por engano).

7. **P2034 (conflito de serialização) entre sync e revisão manual** não tinha tratamento
   específico no lado do sync — colisão transitória e esperada (as duas transações são
   Serializable exatamente para isso) marcava a rodada INTEIRA como FAILED, sem retry, gerando
   ruído recorrente em /runs. `run.ts` ganhou `persistComRetry` (até 3 tentativas, backoff curto)
   antes de desistir.

**Achados 8-10 — decisão de produto do usuário: fidelidade total ao Python nos três, implementada:**

8. **[CRÍTICO]** Data Crédito com hora anexada (ex. "13/07/2026 17:08:35"): o Python falha ao
   parsear (strptime rígido, sem remover hora) e **exclui a fatura inteira** silenciosamente se
   essa for a única data que bateria no período; o TS removia a hora deliberadamente e incluía a
   fatura — o comentário alegava "mesma semântica... do script real", o que a verificação
   adversarial provou falso por execução direta do Python. **Usuário escolheu replicar o Python**
   mesmo sendo uma falha de parsing do original, não uma decisão intencional dele. Corrigido:
   `parseFlexibleDate` não remove mais a hora — o regex ancorado (`^...$`) rejeita qualquer
   sobra depois da data, igual ao `strptime` rígido. Efeito em cascata aceito conscientemente:
   para Data Crédito, se a hora estiver grudada na ÚNICA data que bateria no período, a fatura
   inteira passa a ser excluída da rodada.

9. Arredondamento em empates exatos: `roundMoney` usava `Decimal.ROUND_HALF_UP` sobre aritmética
   decimal exata; o Python usa `round()` (half-to-even) sobre float64 já impreciso. Em splits que
   caem num empate exato (ex. 50/50, 1/8), os dois lados podiam arredondar o MESMO item para lados
   opostos — o TOTAL da fatura sempre fecha (o resíduo corrige), mas a CATEGORIA que absorve o
   centavo podia divergir. Verificado numericamente que trocar para ROUND_HALF_EVEN não garante
   paridade total (o erro de representação binária do float é a causa real, não só o modo de
   desempate) — **usuário escolheu aproximar mesmo assim**. Corrigido: nova `roundMoneyRateio`
   (money.ts, HALF_EVEN) usada SÓ no arredondamento por item e no resíduo de ajuste do rateio
   (categorize-invoices.ts) — o `roundMoney` genérico (HALF_UP) usado no resto do app não mudou.

10. Join CR×LV: quando `ID Cliente` vem vazio em CR e LV do mesmo mês, o Python usa `None` como
    componente de chave normalmente (podem colidir); o TS bloqueava esse casamento nos dois lados
    incondicionalmente. Severidade baixa — nenhuma evidência de ter ocorrido em dado real.
    **Usuário escolheu replicar o Python.** Corrigido: removidas as duas guardas de
    `clienteId === null` em join.ts — a chave já é uma string (`clienteId + "|" + ym`), então
    `null` vira o literal `"null"` na concatenação, mesmo efeito de colisão do dict Python, sem
    precisar de tratamento especial. A guarda de `!cr.competencia` (motivo diferente, não
    auditado) permanece intocada.

**Refutados na verificação adversarial (não são achados válidos):**

- Upserts sequenciais (sem batching) dentro da transação de 120s de `persistLinhasCategorizadas`
  — já é um risco aceito e documentado explicitamente na ADR-0013 ("revisitar se crescer muito"),
  com critério de revisita definido; os números usados pelo achado para alegar urgência (>1000
  linhas, perto do limite) são contraditados pelos volumes reais já registrados no projeto
  (684–895 faturas, "segundos a poucos minutos" a rodada inteira).
- `parseMoneyCell` não remover prefixo "R$"/milhar-com-espaço como o Python faz — mecanismo real,
  mas o cenário de gatilho já foi checado contra dado real (financial-rigor.md, 2026-07-21) e não
  ocorre nas colunas em questão; e mesmo que ocorresse, o efeito seria uma falha VISÍVEL (rodada
  marcada FAILED) em vez de um número errado silencioso — o comportamento que o projeto já
  documenta como o correto (financial-rigor.md #2/#8).

**Validado:** typecheck limpo, 105 testes (6 novos cobrindo especificamente os itens 2/3/4/8/9/10),
e o pipeline real (`parseContasReceberRows`/`statusAceitoCR`/`parseFlexibleDate` já editados)
rodado de novo contra o export ao vivo do Conexa (mesmo período testado antes das correções) —
mesmíssimo resultado (758 faturas, R$279.852,89) em DUAS rodadas de verificação (antes e depois
dos achados 8-10): nenhuma regressão no dado real, nem mesmo a mudança de fidelidade de Data
Crédito (achado 8) excluiu alguma fatura real desse conjunto — nenhuma delas tem Data Crédito
com hora anexada como única data do período nesta amostra.

**Status:** aceito — todos os 10 achados confirmados corrigidos (itens 1-7 eram bugs sem
ambiguidade; itens 8-10 envolviam trade-off e o usuário escolheu fidelidade total ao Python nos
três, corrigidos em seguida).

## ADR-0020 — Tombstone de fatura que some por completo (risco aceito desde a ADR-0012, resolvido)

**Contexto:** depois de resolver as 12 faturas com dupla contagem (ADR anterior desta sessão) via
`/conflitos`, o usuário perguntou por que o Total Recebido do Panorama ainda não batia com o
total que a própria sincronização mais recente reportava. Construída uma conferência completa
(`scripts/conferencia-completa.mjs`) que compara três números pro mesmo período: (1) verdade no
Conexa agora, (2) o que está no banco, (3) o que a skill diria sem revisão manual. (2) e (3)
bateram entre si (0 revisão manual com valor alterado) — descartando revisão manual como causa —
mas (3) divergiu de (1) em R$5.229,40.

**Causa raiz confirmada com dado real** (`scripts/diagnostico-residuo-motor.mjs`, comparação
fatura a fatura contra um fetch fresco do Conexa): 28 faturas somando R$6.029,12 estavam
persistidas no banco (a maioria "Endereço Fiscal", `status` "Quitada") mas o Conexa não as aceita
mais para este período. `persistLinhasCategorizadas` (persist.ts) só reavaliava "esta linha ainda
deveria existir?" para faturas presentes no RESULTADO da sincronização atual (`existentes`
buscado por `crConexaId IN (ids de linhas)`) — uma fatura que foi aceita numa rodada antiga e
depois SOME por completo do resultado (status mudou pra algo não aceito, ou a Data Crédito foi
corrigida/mudou de mês no Conexa) nunca aparecia nessa busca, então sua linha nunca era
reavaliada — ficava no banco para sempre. Isto é DIFERENTE de uma órfã comum (tratada desde a
ADR-0013): órfã é quando a fatura CONTINUA aparecendo mas muda de bucket; aqui a fatura
desaparece inteira. Era exatamente o risco documentado como aceito, não resolvido, na ADR-0012
("tombstone de fatura cancelada/estornada").

**Corrigido:** `existentes` agora busca por `crConexaId IN (...)` **OU** `dataCredito` dentro do
período da própria rodada (`persistLinhasCategorizadas` ganhou os parâmetros `periodoInicio`/
`periodoFim`, passados por `run.ts` a partir de `params`). O resto da lógica de órfã (preservar se
`revisadoManualmente`, apagar senão; conferir conflito de dupla contagem) já lidava corretamente
com "linha não reproduzida nesta rodada" — só faltava a query trazer essas linhas para dentro do
laço. Autocorretivo: a partir do próximo tick do auto-sync (15 em 15 min), as 28 linhas
confirmadas como obsoletas são automaticamente apagadas (nenhuma era revisada manualmente) —
nenhum script de limpeza pontual foi necessário.

**Decisão explícita tomada com o usuário:** perguntado se não seria mais simples apagar todo o
histórico e resincronizar do zero agora que a sincronização está correta — recomendado NÃO fazer
isso: (a) um wipe apagaria qualquer revisão manual com categoria diferente mas valor igual ao
calculado pela skill, que a conferência de hoje não detecta (só compara valor, não categoria) e
por isso não se tinha certeza de que não existia nenhuma; (b) resolveria o sintoma, não a causa —
a mesma sujeira voltaria a se acumular com o tempo sem o fix em `persist.ts`. Usuário concordou
com a investigação antes da correção.

**Validado:** typecheck limpo, 111 testes (sem teste dedicado para este fix — `persist.ts` é
`server-only`, depende de Prisma, mesmo padrão de não-teste-unitário-direto já usado para todo o
resto deste arquivo). Confirmado com dado real de produção via
`scripts/diagnostico-residuo-motor.mjs` antes da correção (782 faturas aceitas no Conexa vs 810
no banco, 28 só no banco). Verificação pós-deploy pendente: rodar o mesmo diagnóstico depois do
próximo tick do auto-sync e confirmar "0 faturas no banco que o Conexa não aceita mais".

**Status:** aceito.

## ADR-0021 — Data Crédito no futuro sendo aceita como já recebida

**Contexto:** depois da ADR-0020, o usuário confirmou 3 rodadas automáticas "Concluída" já
calculando o total certo (782 faturas, R$286.220,65 — bate exato com o Conexa), mas
`diagnostico-residuo-motor.mjs` continuou mostrando as MESMAS 28 faturas obsoletas, idênticas.
Investigado com `scripts/inspecionar-linha.mjs` (estendido para mostrar `dataCredito` exato e a
origem/período da última rodada que tocou cada linha).

**Causa raiz confirmada:** as 28 faturas têm `dataCredito` **no futuro** (27, 28, 29/07 — "hoje"
é 24/07), todas gravadas pela mesma `RevenueSyncRun` — `origem: MANUAL`, período
**28/06/2026 a 31/07/2026**, rodada em 23/07 às 16:52 (quando "hoje" ainda era 23/07, então
31/07 já era 8 dias no futuro). "Endereço Fiscal" (serviço recorrente/Contratual) domina a
lista — esse tipo de fatura tem uma LISTA de datas de crédito, incluindo parcelas agendadas
ainda não realizadas. A regra de aceitação "qualquer data da lista que caia no período pedido"
(fidelidade total ao Python, ADR-0018/0019) aceitou uma dessas datas FUTURAS como se já fosse
dinheiro recebido, simplesmente porque alguém pediu manualmente um período que ia além de hoje.
**Isto NÃO é o bug da ADR-0020** (aquela correção está certa e funcionando — as 3 rodadas
automáticas provam que o cálculo do dia está correto); é um problema diferente e anterior: dado
já persistido com uma data que ainda não aconteceu.

**Por que o automático nunca causaria isso:** `computeAutoSyncWindow()` sempre usa
`periodoFim = agora` — nunca o fim do mês. Só uma chamada manual (form em `/runs` ou
`POST /api/runs`, ambos aceitando qualquer `periodoInicio`/`periodoFim` sem validação contra
"hoje") pode pedir um período que ultrapasse o dia real.

**Corrigido em `run.ts`:** "Data Crédito" representa dinheiro JÁ creditado — não faz sentido
aceitar uma data além de hoje de verdade, não importa qual período foi pedido (nem automático,
que já nunca pede além de agora por construção, nem manual/API, que pode pedir errado). Calculado
`periodoFimEfetivo = min(params.periodoFim, nowInAppTz())` e usado esse valor (não
`params.periodoFim` direto) como limite superior passado para `parseContasReceberRows` —
`fetchBothExports` (o que é pedido ao Conexa) continua usando o período original, sem problema,
já que buscar um conjunto mais largo é inofensivo; só a ACEITAÇÃO de uma data como "dentro do
período" é que precisa do limite real. A chamada a `persistLinhasCategorizadas` continua usando
`params.periodoFim` original (não o clampado) de propósito: isso faz a checagem de linha órfã
enxergar (e limpar sozinha) qualquer dataCredito futura remanescente dentro do período pedido,
como efeito colateral positivo, caso isto se repita.

**Limpeza do dado já persistido:** `scripts/limpar-datacredito-futuro.mjs` (novo, standalone) — 
apaga toda `RevenueCategorizedLine` com `dataCredito` além de hoje, EXCETO se
`revisadoManualmente` (nesse caso preserva e reporta, nunca deveria acontecer dado o mecanismo,
mas checado por segurança). Idempotente. Quando a data real chegar, a sincronização automática
recria a fatura corretamente, se ainda válida — apagar agora não perde informação real, só
remove o que foi contado cedo demais.

**Validado:** typecheck limpo, 111 testes (sem teste dedicado para o clamp em si — depende de
`nowInAppTz()`/hora real, mesmo padrão de não-teste-unitário-direto de todo o resto de `run.ts`).
Achado confirmado com dado real de produção (`scripts/inspecionar-linha.mjs`) antes da correção,
não apenas hipótese.

**Status:** aceito.

## ADR-0022 — Metas: escopo unificado + granularidade trimestral (substitui ADR-0016 nesses dois pontos)

**Contexto:** alinhado com a Duda em 2026-07-24. Dois pontos da ADR-0016 mudaram por decisão de
produto: (1) em vez de 3 escopos separados por unidade (Seaway Center, Sebrae, Ayrton Senna), o
acompanhamento deve ser um único "Serviços de Espaço" somando as 3; (2) a meta passa de mensal
para **trimestral** — trimestre civil (Q1 jan-mar, Q2 abr-jun, Q3 jul-set, Q4 out-dez) vira o
átomo, mês deixa de aceitar meta (junto com dia e semana, que já não aceitavam).

**Escopo unificado:** `ESCOPOS_INICIAIS` (escopos.ts) e o `ESCOPOS` duplicado em
`scripts/seed-metas.mjs` passam de 3 entradas para 1 (`slug: "servicos-de-espaco"`), cobrindo as
5 strings de categoria das 3 unidades (Seaway Center não tem split de grafia; Sebrae e Ayrton
Senna têm 2 cada — ver comentário em escopos.ts, mesmo motivo da ADR-0017/0018). Migration
`20260725000000_metas_trimestrais` remove os 3 `MetaEscopo` antigos do banco (`DELETE ... WHERE
slug IN (...)`, protegido pelo `ON DELETE RESTRICT` de `MetaPeriodo.escopoId` — se alguma meta
real ainda os referenciasse, o DELETE falharia alto em vez de perder dado); o novo escopo é
recriado pelo seed no próximo boot, não precisa ser inserido na migration.

**Granularidade trimestral:** `MetaPeriodo.anoMes` ("yyyy-MM") renomeado para `anoTrimestre`
("yyyy-Q#"), com CHECK constraint e índice/unique key correspondentes recriados na migration.
Nenhuma meta real existia em produção até a mudança (confirmado antes de decidir a estratégia da
migration) — por isso a migration começa com `DELETE FROM meta_periodos` explícito (não um
TRUNCATE silencioso) em vez de tentar converter valores mensais em trimestrais, o que não tem
conversão sensata (a Duda define números novos por trimestre, não herda os antigos). `periodo.ts`
ganhou `trimestresDoPeriodo`/`trimestreDaData`/`ANO_TRIMESTRE_RE` substituindo
`mesesDoPeriodo`/`mesDaData`/`ANO_MES_RE`; `periodoAceitaMeta` agora só aceita
quarter/semester/year (mês excluído, mesmo raciocínio já usado pra dia/semana: ratear uma meta
trimestral por um recorte menor assumiria receita uniforme e inventaria número). `metas.ts`
(`buildMetas`) e `actions.ts` (`definirMetaAction`/`removerMetaAction`) atualizados para a nova
chave; formulário (`metas-form.tsx`) trocou o `<input type="month">` por dois `<select>` (Ano +
Trimestre, HTML não tem input nativo de trimestre) combinados na action; "repetir até dezembro"
virou "repetir para os trimestres seguintes do ano" (mesma ideia, agora limitada a Q4 do ano).

**Validado com dado real, não só typecheck:** migration aplicada com sucesso contra Postgres real
(dev), incluindo confirmação de que o dev DB tinha 2 `MetaPeriodo` de teste (removidos, sem
problema — são dado de teste, não financeiro) e os 3 escopos antigos (removidos igual); seed
rodado 2x contra o mesmo banco (idempotente, 1 escopo/5 categorias nas duas vezes);
`buildMetas` chamado direto contra o banco real com uma meta de teste (Q3 2026, R$100.000) e
faturas reais já persistidas (Seaway R$30.561,99 + Sebrae R$3.643,89 + Ayrton R$0,00) — resultado
bateu exato: `realizado: "34205.88"`, `percentual: 34.2`; confirmado que `month` agora retorna
`aplicavel: false` (antes retornava `true`) enquanto quarter/semester/year continuam `true`.
Smoke test de navegador real: sessão JWT + linha `Session` criadas à mão (mesmo mecanismo de
`createSession`) para autenticar como o admin real do dev DB, `/metas?ano=2026` e `/?g=quarter`
renderizados via `curl` autenticado — confirmado visualmente (grep no HTML) o card único "Serviços
de Espaço" no Panorama com o valor agregado correto, e a tela de definição de meta com os
seletores de Ano/Trimestre e as 5 categorias somadas. Meta de teste e sessão removidas depois;
dev DB parado ao final, sem deixar resíduo.

**Status:** aceito.

## ADR-0023 — Integração ClickUp: espelhar receita categorizada nos campos de mês de "Eficiência"

**Contexto:** o ClickUp tem tarefas (lista "Eficiência", pasta "Gestão de clientes") com um campo
customizado Currency por mês (Janeiro..Dezembro) guardando o faturamento de um cliente/serviço —
hoje preenchido à mão. Pedido do usuário: alimentar esses campos a partir do skill-financeiro, a
cada sincronização (mesmo ritmo do auto-sync de 15 em 15 min), não só no fechamento do mês.

**Explorado ao vivo contra a API real antes de desenhar o modelo** (2026-07-27, token pessoal do
usuário): lista "Eficiência" (id `901326339447`) tem 100 tarefas e 29 campos customizados
compartilhados por TODAS elas (schema de lista, não por tarefa — a preocupação do usuário de que
"tarefas diferentes podem ter campos diferentes" não se confirmou: o que varia é só QUAIS campos
vêm preenchidos, não o conjunto de campos existentes). Achado real que mudou o desenho do
matching: o campo de novembro está gravado como **"Novembo"** (sem o R) — um typo de produção que
provaria qualquer casamento por nome EXATO errado. `resolverCamposPorMes` (mes-fields.ts) casa
contra uma lista EXPLÍCITA de variantes exatas por mês (normalizado sem acento/caixa) — "novembro"
e "novembo" ambos aceitos para o mês 11, qualquer nome diferente é ignorado. A primeira versão
tentava casar por PREFIXO de 3 letras em vez disso; foi trocada depois que a revisão adversarial
abaixo mostrou que isso colidia com nomes de campo plausíveis e não relacionados ("Novidades",
"Setor Comercial", "Margem de Lucro" batiam em novembro/setembro/março só pelo prefixo).

**Achado que reduziu o escopo do v1:** as 100 tarefas da lista são de dois tipos bem diferentes —
tarefas por CLIENTE (ex. "Endereço Fiscal Batial", 1 serviço + 1 cliente, casa direto com
`(categoria, clienteConexaId)` de `RevenueCategorizedLine`) e tarefas por SALA/espaço físico (ex.
"Sala 05 - Loja 30", ligadas a um espaço que pode trocar de inquilino, sem chave equivalente no
nosso schema hoje). Perguntado ao usuário; decisão: **v1 cobre só categorias por cliente**
(Endereço Fiscal, SeaBox etc.) — Salas Privativas/Serviços de Espaço ficam de fora até existir uma
chave de correspondência por sala, sem código nenhum forçando isso (o admin simplesmente não
cadastra vínculo pras categorias de sala).

**Modelo de dados** (`ClickUpVinculo`/`ClickUpListaCache`/`ClickUpPushLog`, prisma/schema.prisma):
vínculo explícito 1 tarefa ↔ 1 `(categoria, clienteConexaId)`, cadastrado por um admin — nunca por
nome parecido (é dinheiro). `ClickUpListaCache` guarda os fieldIds dos 12 meses por lista (evita
bater em "get list fields" a cada push; refaz sozinho se um push não achar o campo do mês). Toda
tentativa (sucesso ou falha) vira `ClickUpPushLog` — nunca falha em silêncio.

**Corpo do POST de campo Currency confirmado na documentação oficial** (`{ "value": <number> }`,
sem wrapper) antes de escrever `setTaskFieldValue` — dispensou uma escrita de teste contra a lista
real só pra descobrir o formato.

**Isolamento (não negociável):** o push roda dentro de `startCategorizationRun` (run.ts), logo
após persistir com sucesso, mas embrulhado no seu PRÓPRIO try/catch — uma falha do ClickUp (token
errado, API fora do ar, rate limit) nunca marca a rodada como FAILED nem impede a sincronização de
receita, que é o que importa de verdade. Dentro do push, cada vínculo também é isolado: a falha de
um nunca impede os demais. `devePush` (decisao-push.ts) pula o envio quando o valor não mudou —
poupa cota (100 req/min) e não polui o histórico de alteração do campo no ClickUp; a tela admin
(`/integracoes/clickup`, ADMIN-only) tem um botão "Empurrar agora" que ignora essa checagem, para
testar um vínculo sem esperar a próxima rodada.

**Revisão adversarial (multi-agente, 4 dimensões: isolamento, dinheiro/precisão, segurança,
matching/schema) rodada antes do commit, 2026-07-27 — 10 achados confirmados, todos corrigidos:**

- **CRÍTICO — fuso duplo em `periodoCorrente()`:** `nowInAppTz()` já devolve um Date ajustado ao
  fuso; repassá-lo como segundo argumento de `getPeriodBounds` fusava DUAS vezes — nas primeiras
  ~3h de todo mês, o período calculado caía no mês ANTERIOR (mesmo bug já achado e corrigido em
  `scheduler/auto-sync-window.ts`, reintroduzido aqui). Resultado sem o fix: receita de julho
  sendo escrita no campo de agosto do ClickUp, todo santo mês, com `sucesso: true` no log. Extraído
  para `src/lib/clickup/periodo-corrente.ts` (puro, testável) com teste de regressão dedicado
  (`periodo-corrente.test.ts`, fake timers no exato instante do achado).
- **CRÍTICO — matching por prefixo colidia com campos reais:** ver acima; trocado por lista
  explícita de variantes exatas (`VARIANTES_MES`).
- **ALTO — CHECK `valorEnviado >= 0` impedia logar push de valor negativo:**
  `RevenueCategorizedLine.valorRecebidoCat` pode ser negativo (estorno/reembolso do cliente no
  mês) sem constraint nenhuma; o CHECK na migration fazia o INSERT do log falhar justo nesse caso
  — inclusive o insert de fallback do `catch`, que ficava silenciosamente engolido pelo
  `.catch(() => {})`. Push realmente aconteceu, zero rastro no banco. Constraint removida da
  migration (nunca tinha sido aplicada fora do dev DB local — editada em vez de nova migration).
- **ALTO — cache de campo nunca se autocurava:** o comentário do model `ClickUpListaCache`
  prometia refresh "por um botão na UI" que nunca existiu. Trocado por autocura de verdade: se a
  ESCRITA de um campo falhar, `escreverComAutoCura` atualiza o cache e tenta de novo uma vez antes
  de desistir.
- **MÉDIO — `res.json()` sem checar corpo vazio:** uma resposta 2xx sem corpo (204, ou 200 vazio)
  faria `JSON.parse` explodir mesmo com o campo já escrito com sucesso no ClickUp. `api()` agora
  trata corpo vazio como sucesso sem dado.
- **MÉDIO — thrash de rede quando um mês genuinamente não tem campo:** sem cache negativo, todo
  push de todo vínculo daquela lista batia na API de novo. Agora só refaz a busca depois de
  `CACHE_MAX_AGE_MS` (1h).
- **MÉDIO — path traversal via `clickUpListId`/`clickUpTaskId`:** um valor tipo
  `86ahe39fe/../../../../list/999888777` colado no formulário (sem ser uma URL válida, então a
  extração de ID não filtrava) virava parte literal do path da chamada HTTP, redirecionando pra
  outro endpoint da mesma API do ClickUp com o token do servidor. Validado em duas camadas: zod na
  action (`ID_CLICKUP_RE`) e de novo em `client.ts` antes de montar a URL (defesa em profundidade).
- **MÉDIO — vínculo sem nenhuma linha histórica correspondente:** criar um vínculo pra uma
  combinação `(categoria, clienteConexaId)` que nunca apareceu em `RevenueCategorizedLine` (typo na
  categoria, por exemplo) empurraria R$ 0,00 todo mês, indistinguível de um mês real sem receita.
  `criarVinculoAction` agora AVISA (não bloqueia) quando isso acontece.
- **MÉDIO (aceito, não corrigido) — push sequencial pode esticar o ciclo de sincronização:** com
  ClickUp lento/degradado (não fora do ar, só lento), cada vínculo pode levar até ~15s (timeout) e
  o loop é sequencial de propósito (respeitar o limite de 100 req/min). Para o volume esperado do
  v1 (poucos vínculos, só categorias por cliente) isso é aceitável; documentado como risco
  conhecido, não construída uma solução (ex.: orçamento de tempo global pro loop) fora de escopo
  do v1.
- **MÉDIO (aceito, não corrigido) — `categoria` é texto livre sem enumeração de variantes:**
  diferente de `MetaEscopoCategoria` (que enumera toda grafia viva da mesma categoria), um
  `ClickUpVinculo` fica preso a UMA string exata; se a grafia da categoria mudar depois (mesmo
  problema documentado na ADR-0017), o vínculo para de casar silenciosamente. O aviso de "sem
  histórico" acima cobre o caso do typo na criação; drift POSTERIOR à criação não é coberto — risco
  aceito dado o escopo do v1 (poucas categorias, admins cientes).

**Status:** aceito, corrigido pós-revisão. Migration `20260727000000_clickup_integracao` aplicada
contra o dev DB local; typecheck limpo, 128 testes; push real contra a API do ClickUp ainda não
testado (nenhum vínculo real cadastrado ainda, e nenhuma chamada de rede foi feita nesta sessão por
pedido explícito do usuário) — ver progress.md para o estado exato da validação.

**Superado pela ADR-0024 abaixo** na única decisão que importava de verdade: a chave de
correspondência do vínculo. Tudo o mais desta ADR (modelo de isolamento, cache de campos,
matching de mês, revisão adversarial) continua valendo.

## ADR-0024 — ClickUpVinculo por PADRÃO de texto, não por cliente (corrige premissa da ADR-0023)

**O que estava errado:** a ADR-0023 modelou `ClickUpVinculo` como `(categoria, clienteConexaId)`
— um vínculo, um cliente específico. O usuário apontou o erro direto: "Endereço Fiscal Batial" não
é um cliente, é a SOMA de todos os clientes que usam aquele produto. Eu tinha assumido isso a
partir do NOME da tarefa no ClickUp, sem checar os dados de verdade.

**Confirmado com investigação real (pedida pelo usuário: "quero que analise tudo"):**

- Na API do ClickUp, as tarefas "Endereço Fiscal Batial/Litoral/Abissal" têm os campos `Clientes` e
  `LOCATÁRIO` (relacionamento) **vazios** — nenhum cliente específico ligado. Já as tarefas de sala
  física (ex. "Sala 02 - Loja 26") têm `LOCATÁRIO` preenchido com o inquilino atual. Ou seja: nem
  todas as tarefas seguem o mesmo padrão de "1 cliente", e as que pareciam mais óbvias (Endereço
  Fiscal) são justamente as que somam TODOS.
- No banco real: a categoria "Endereço Fiscal" tem **555 linhas de 519 clientes distintos**;
  "Serviços de Espaço - Seaway Center" tem 163 linhas de 133 clientes; "SeaBox" tem 14 linhas de 11
  clientes. TODA categoria do sistema tem dezenas a centenas de clientes diferentes — não existe
  categoria genuinamente "de 1 cliente só".
- O que de fato distingue "Batial" de "Litoral" de "Abissal" é um SUBSTRING dentro do texto livre
  de `servicoOuPlano` (o "Serviço/Plano" da fatura no Conexa), não a categoria nem o cliente: ex.
  `"Seatech - EV - Endereço Fiscal Batial Mensal (SEATECH)"`, `"Endereço Fiscal Batial Mensal
  (SEAHUB COWORKING)"`, `"EV - Endereço Fiscal Batial Anual (SEAHUB COWORKING)"` — nomes bagunçados,
  mas todos contêm "Batial". O MESMO mecanismo cobre tarefas de sala física: o padrão vira o nome
  da sala (ex. "[SEAWAY] - SALA DE ATENDIMENTO 02"), eliminando de vez a divisão "categoria por
  cliente vs. categoria por sala" que a ADR-0023 tinha inventado — não existe essa divisão, é tudo
  a mesma coisa (categoria + padrão de texto, soma quem bater).

**Modelo corrigido:** `ClickUpVinculo.clienteConexaId`/`razaoSocialCache` removidos;
`ClickUpVinculo.padroes` (Json, `string[]`) no lugar — um vínculo soma toda
`RevenueCategorizedLine` cuja `categoria` bate E cujo `servicoOuPlano` contém QUALQUER UM dos
padrões (`contains`, case-insensitive; OR entre padrões). `src/lib/clickup/filtro-padroes.ts` (puro,
testado) monta esse filtro e é reaproveitado tanto pelo push real quanto pela prévia da tela admin.
Unique constraint antiga (`categoria` + `clienteConexaId`) removida — não existe mais um par
natural para travar; duplicidade de padrão entre vínculos é responsabilidade do admin, mitigada
pela prévia abaixo, não por uma constraint de banco (padrão é substring, não dá pra travar
sobreposição via SQL de forma confiável).

**Nunca por nome parecido inferido às cegas (é dinheiro):** a tela admin (`NovoVinculoForm`) tem um
botão "Pré-visualizar" (`previsualizarVinculoAction`) que roda ANTES de salvar — mostra, pra
categoria + padrões digitados, cada `servicoOuPlano` real que bate (com ocorrências e clientes
distintos) e o total do MÊS CORRENTE exato que seria empurrado. Só depois de conferir isso o admin
clica em "Vincular". `criarVinculoAction` ainda avisa (não bloqueia) se nenhuma linha histórica
bate com a combinação, mesma rede de segurança de antes, agora aplicada ao padrão em vez de ao
cliente.

**Validado com dado real:** `filtroPorPadroes("Endereço Fiscal", ["Batial"])` contra o dev DB real
achou 75 linhas / **65 clientes distintos** / R$ 12.323,25 — confirma exatamente o comportamento
pretendido (soma de múltiplos clientes por um padrão só). Isolamento (push sem token, sem log, sem
rede) re-testado com o novo schema e continua correto. Typecheck limpo, 135 testes (7 novos em
`filtro-padroes.test.ts`).

**Correção seguinte, mesmo dia — matching precisa ignorar acento, não só caixa.** Usuário: "temos
as duas escritas (Comercio e Comércio)... não consegui mapear as duas de uma vez só na tarefa."
Confirmado no dev DB real: a categoria "Endereço Fiscal" tem 5 linhas reais de "Comércio"/
"Comercio" convivendo (3 com acento, 2 sem — `SEAHUB COWORKING` e `SEATECH` escrevem diferente),
mesmo padrão de variação já visto em espaçamento (ADR-0017). O filtro original
(`servicoOuPlano: { contains, mode: "insensitive" }` do Postgres) só ignora maiúscula/minúscula —
acento é outra colação, e o Postgres não dobra as duas por padrão. **Corrigido: o casamento saiu
da query do Postgres e passou a acontecer em JS.** `filtroPorPadroes` (que montava o `where` do
Prisma) foi substituído por `bateAlgumPadrao` (puro) em `filtro-padroes.ts`, usando um
`normalizarTexto` compartilhado (NFD + descarta marca diacrítica + lowercase — extraído para
`src/lib/text-normalize.ts`, o mesmo algoritmo que já existia isolado dentro de `mes-fields.ts`
para o nome dos campos do ClickUp, agora reaproveitado nos dois lugares). `push.ts`/`actions.ts`
agora buscam as linhas só por `categoria` (+ `dataCredito` quando for o caso) e filtram por
padrão em memória — categoria isolada raramente passa de algumas centenas de linhas, então o
custo é desprezível tanto no push periódico quanto na prévia da tela. Validado contra o dado real:
um único padrão "Comércio" (ou "Comercio", indiferente) agora bate nas 5 linhas reais (3 com
acento + 2 sem), somando R$ 3.099,60 — antes exigiria dois padrões cadastrados à mão pro admin
cobrir as duas grafias. Typecheck limpo, 142 testes (novo `text-normalize.test.ts` + 6 novos em
`filtro-padroes.test.ts` cobrindo o caso Comércio/Comercio nos dois sentidos).

**Status:** aceito. Mesmas pendências da ADR-0023 (push real de teste contra a API ainda não feito).

**Correção seguinte, mesmo dia — excluir vínculo e confirmar push automático.** Usuário já tinha
vínculos reais cadastrados e funcionando em produção (`/integracoes/clickup` real, 4 vínculos de
"Endereço Fiscal" com pushes bem-sucedidos) e pediu duas coisas: (1) não existia como apagar um
vínculo, só ativar/desativar; (2) "verifique e assegure" que o push acontece automaticamente em
toda sincronização (não só quando alguém clica "Empurrar agora").

- **Excluir vínculo:** `excluirVinculoAction` (checkRole ADMIN, `delete` por id, P2025 tratado
  como sucesso — já não existia, sem erro) + `ExcluirVinculoButton` na tela, mesmo padrão de
  confirmação inline de dois cliques já usado em `/conflitos`
  (`BotaoExcluirLinha`/"Confirma excluir? Sim, excluir / Cancelar" — nunca um `window.confirm()`
  nativo, não é o padrão deste app). Apaga só `ClickUpVinculo` e seu `ClickUpPushLog` (cascade) —
  `RevenueCategorizedLine` nunca é tocada, confirmado contra o dev DB real.
- **Push automático — confirmado por leitura direta do código, não suposição:** `run.ts` chama
  `pushValoresDoMesCorrente()` incondicionalmente depois de QUALQUER rodada bem-sucedida, sem
  ramificação por `origem` — `runAutoSyncTick()` (auto-sync.ts) chama `startCategorizationRun`
  com `origem: "AUTOMATICO"`, que passa pelo EXATO mesmo caminho de código de uma rodada manual.
  Os horários vistos no print do usuário (poucos minutos entre si) eram de cliques manuais em
  "Empurrar agora" — que testa um vínculo isoladamente, sem rodar sincronização nenhuma — não de
  ticks automáticos.
- **Visibilidade adicionada** (pra o próprio usuário conseguir confirmar isso sem acesso ao
  banco): `pushValoresDoMesCorrente()` agora devolve um resumo
  (`{ vinculosAtivos, atualizados, semMudanca, falharam }`) em vez de `void`; `run.ts` loga esse
  resumo depois de toda rodada (`[run] ClickUp: N vínculo(s) ativo(s) — X atualizado(s), Y sem
  mudança, Z falha(s).`) — visível nos logs do servidor (Easypanel) a cada ciclo de 15 min,
  automático ou manual. **Nuance importante para o usuário entender o comportamento:**
  `devePush` pula o envio quando o valor não mudou desde o último sucesso — depois de um teste
  manual forçado, o próximo tick automático pode legitimamente não reenviar nada (e não atualizar
  "Último envio") se a receita daquele produto não mudou nesse meio-tempo; isso é o comportamento
  pretendido (evitar chamada redundante), não uma falha do mecanismo.
- Validado: typecheck limpo, 142 testes, exclusão testada contra o dev DB real (cascade correto),
  resumo testado (sem token, `vinculosAtivos` fica 0 mesmo com vínculo real cadastrado — early
  exit antes de qualquer query, garantia de isolamento preservada).

**Salas Privativas: dois bugs novos achados ao tentar cobrir as 3 unidades (Ayrton Senna, Sebrae,
Seaway Center), corrigidos antes de criar qualquer vínculo (2026-07-28):**

1. **Espaçamento repetido quebra o casamento por substring.** A mesma sala aparece no
   `servicoOuPlano` real com 1, 2 ou 3 espaços (`"Sala 08 - Loja 24"` vs `"Sala 08   - Loja 24"`)
   — o Postgres/nosso `bateAlgumPadrao` ignoravam acento e caixa, mas não espaço repetido, então
   um padrão com o espaçamento "errado" simplesmente não batia, sem erro nenhum. Corrigido em
   `normalizarTexto` (`src/lib/text-normalize.ts`): `.replace(/\s+/g, " ")` depois de tirar
   acento/caixa — afeta os dois usos compartilhados (mês do ClickUp e padrão de vínculo).
2. **Sobreposição entre vínculos da mesma categoria — risco de dobrar dinheiro.** Faturas que
   combinam VÁRIAS salas na mesma linha (um cliente alugando 3 salas de uma vez vira uma linha só
   com valor único pras 3 juntas, ex. "Sala 08+09+10 - Sebrae" = R$8.200) fariam DOIS vínculos (um
   por sala) somarem o MESMO valor cada um se eu criasse um pra cada sala envolvida — nunca
   detectável olhando o padrão novo isolado. Nova função `acharSobreposicoes`
   (`filtro-padroes.ts`, testada): compara as linhas que um padrão NOVO casaria contra os padrões
   de todo vínculo ATIVO já cadastrado da mesma categoria. Na prévia da tela, isso vira um aviso
   visual; em `criarVinculoAction`, isso **bloqueia** a criação (não é só aviso como o "sem
   histórico" — aqui o dano é certo, não hipotético, então não faz sentido deixar criar mesmo
   avisando).

**Mapeamento sala→tarefa gerado programaticamente, não digitado à mão:** cruzou o valor real do
dropdown "Nome da sala" de cada tarefa do ClickUp (que espelha o nome do contrato da Conexa, ex.
"Contrato: Sala 03 - Ayrton Senna") contra os `servicoOuPlano` distintos de cada categoria "Salas
Privativas - X" no banco — usar o valor do dropdown em vez do nome de exibição da tarefa foi o que
resolveu ambiguidades que uma tentativa manual anterior não tinha notado (ex. "Estação de estudo
02 - Loja 08" só aparece no dropdown, não no nome da tarefa). Achados da investigação:
- **7 salas com receita real não têm tarefa correspondente no ClickUp ainda**: Loja 05, 08, 09,
  11, 12, 13, 14 (várias combinações "Sala X - Loja Y"), mais Estação 05 - Coworking L21 e
  "Coworking Estação 08" — ficam de fora até alguém criar a tarefa lá (confirmado via o campo
  dropdown ter a OPÇÃO pré-cadastrada pra Loja 05/11/12/13/14 mas nenhuma task usando ela — alguém
  previu a sala, nunca criou o rastreamento).
- **2 grupos de faturas combinadas** foram pegos pela checagem de sobreposição e tiveram só 1 sala
  vinculada (a primeira processada) — Sebrae "Sala 08+09+10" (ficou só com Sala 10) e Seaway
  "Sala 06+07 - Loja 24" (ficou só com Sala 07).
- `scripts/seed-clickup-salas-privativas.mjs` (novo, idempotente, mesmo padrão de
  `resolver-conflitos.mjs`): cria os 36 vínculos confirmados (+ 1 sala sem fatura ainda,
  cadastrada de antemão). Validado com dry-run duplo contra o dev DB real: primeira rodada criou
  36, segunda rodada não criou nada de novo (idempotente) e reportou as mesmas 3 sobreposições
  esperadas.

**Rodado em produção (2026-07-28), via Console do Easypanel** (mesmo dia do ADR-0025, depois de
diagnosticar um falso alarme — o usuário tinha digitado o comando sem o `node` na frente, o que
não trava de verdade, só não executa nada visível): 36 criados, 3 pulados por sobreposição — igual
ao dry-run.

**Status:** aceito, rodado em produção.

## ADR-0025 — Demais categorias ClickUp (SeaBox, Meu Depósito, Serviços de Espaço) + proteção real de sobreposição no push

**Contexto:** depois de Salas Privativas, usuário perguntou o que mais faltava vincular. Resposta
levantada da distribuição de categorias já conhecida: SeaBox, Outros Serviços, Hub
Empreendedoras, Meu Depósito e Serviços de Espaço (3 unidades, estrutura por sala igual Salas
Privativas, 175 linhas reais — maior volume que Salas Privativas).

**Achado de processo, não só de dado — paginação incompleta quase gerou conclusão errada.** O
primeiro dump de tarefas da lista "Eficiência" trouxe só 100 tarefas via `GET /list/{id}/task`
sem paginar; a lista na verdade tem 152. Isso escondia TODAS as tarefas de Meu Depósito e boa
parte das salas do Seaway Center, levando a uma conclusão inicial errada de "sem tarefa" pra
essas duas coisas. Corrigido paginando até `last_page`. Registrado em memória
(`reference_clickup_integration.md`) como lição permanente: **nunca listar tarefas desta lista
sem paginar**.

**Verificação adversarial (3 agentes independentes, rederivando tudo do zero sem olhar conclusão
prévia) confirmou o mapeamento e achou 1 ponto que tinha passado batido:**

- SeaBox (2 tarefas, via `TIPO DE PRODUTO` — únicas entre as 152, não um rótulo repetido tipo
  "Auditório"), Meu Depósito (10 boxes, via "Nome da sala"), Serviços de Espaço - Ayrton
  Senna/Sebrae (3 salas): confirmados sem ambiguidade.
- Serviços de Espaço - Seaway Center (59 `servicoOuPlano` distintos): confirmado o mapeamento de
  ~13 salas específicas + 1 tarefa genérica "Pacote de Horas"; achou que a tarefa de Cabine tem
  "Nome da sala" = "Cabine 01" mas o texto real da fatura é só "Cabine" (sem sufixo) — corrigido
  com padrão manual, única tarefa de cabine existente, sem risco de ambiguidade; confirmou que
  "[SEBRAE] Auditório do Sebrae" (tarefa 86ah8wa55) bate com ZERO linhas reais em qualquer
  categoria — órfã/duplicada, fora do mapeamento.
- **Outros Serviços / Hub Empreendedoras: confirmado, com busca exaustiva (2 espaços do
  workspace, 20+ pastas/listas, tarefas arquivadas e subtarefas, um campo compartilhado com 35
  opções, uma pista falsa promissora investigada e descartada com evidência — um log de despesas
  internas, não catálogo de receita), que não existe NENHUMA tarefa no ClickUp pra nenhum dos 14
  itens dessas 2 categorias.** Nada a criar até alguém montar as tarefas na lista Eficiência —
  usuário confirmou explicitamente que só a lista `901326339447` é alvo válido, nunca outra lista
  do workspace mesmo que pareça relacionada.

**Decisão do usuário — "Pacote de Horas" ganha padrões extras:** a tarefa genérica só batia com
faturas dizendo literalmente "Pacote de horas" (18 de 59 linhas); "Horas do Plano Contratado
(Xh)" e "PH - Xh anuais - [sala]" são o mesmo tipo de produto (hora avulsa) com nome diferente no
Conexa, e ficavam de fora (~27% das linhas, só por diferença de texto). Usuário optou por
mesclar: `padroes: ["Pacote de horas", "Horas do Plano Contratado", "PH -"]` no mesmo vínculo —
mesmo mecanismo já usado pra "Comércio"/"Comercio".

**Achado crítico do próprio dry-run — a proteção de sobreposição existente só protege a
CRIAÇÃO, nunca o push.** Ao rodar `scripts/seed-clickup-servicos-espaco.mjs` contra o dev DB
real, a ordem de criação causou um efeito cascata: "Auditório" (processado primeiro) reivindicou
uma linha gigante combinando 9 salas/produtos, e isso bloqueou a criação de TODAS as demais salas
que também batiam nessa mesma linha (Atendimento 01/02/03, Reunião 01/02/03/04) — mesmo elas
tendo histórico próprio limpo em outras linhas. Investigando a causa, ficou claro um problema
mais sério: `acharSobreposicoes`/o bloqueio em `criarVinculoAction` só compara contra o HISTÓRICO
no momento da criação — `pushUmVinculo` (push.ts) soma cada vínculo ativo de forma totalmente
independente, sem nenhuma checagem cruzada. Pra Salas Privativas/Meu Depósito (contratos mensais
estáveis) esse risco é baixo (raro uma combinação nova surgir depois). Pra Serviços de Espaço -
Seaway Center é estrutural: **29% das faturas históricas já combinam 2+ salas na mesma linha**
(reserva avulsa de sala de reunião, não uma exceção) — qualquer mês futuro em que isso se
repetisse entre 2 vínculos já ativos (mesmo criados sem conflito) dobraria o valor no ClickUp,
silenciosamente, sem nenhum log de erro.

**Decisão do usuário: construir a proteção de verdade no push, não só documentar o risco.** Nova
função pura `linhasExclusivasDoVinculo` (`filtro-padroes.ts`, testada — 5 casos novos): dado o
vínculo atual e os vínculos IRMÃOS ativos da mesma categoria, exclui da soma qualquer linha que
TAMBÉM bata num vínculo irmão mais antigo (`criadoEm` como desempate principal, `id` como
desempate de empate exato — determinístico, os dois lados calculam o mesmo vencedor). Conectada
em `pushUmVinculo`/`pushValoresDoMesCorrente`/`pushVinculoAgora` (push.ts) — agora todo push, não
só a criação, respeita "o vínculo mais antigo fica com a linha combinada". **Validado com dado
real**: os 7 vínculos já criados no dry-run não tinham diferença (a proteção de criação já tinha
descartado os conflitos históricos existentes); simulando uma fatura FUTURA hipotética
combinando Auditório + Atendimento 04 (R$500, cenário que a proteção de criação não cobre por
definição), a soma ingênua dava R$500 a mais no vínculo mais novo — corrigida, some certo.

**3 novos scripts, mesmo padrão de `seed-clickup-salas-privativas.mjs`** (idempotentes,
`clickUpListId` sempre `901326339447`):

- `scripts/seed-clickup-seabox.mjs`: 2 vínculos (Básico/Pro), zero sobreposição possível (nenhuma
  linha combinada nessa categoria).
- `scripts/seed-clickup-meu-deposito.mjs`: 10 boxes (todas as tarefas existem, mesmo as sem
  fatura ainda). 2 pares aparecem sempre combinados na mesma fatura (04+05, 08+10) — só o
  primeiro processado de cada par ganha o vínculo (mesmo tradeoff aceito de Salas Privativas).
- `scripts/seed-clickup-servicos-espaco.mjs`: Ayrton Senna (1) + Sebrae (2) + Seaway Center
  (~13 salas + Cabine com padrão manual + Pacote de Horas com 3 padrões, salas processadas antes
  da tarefa genérica de propósito — ver comentário ORDEM no arquivo).

**Validado com dado real, dry-run duplo (idempotência) contra o dev DB, depois limpo (17 linhas
de teste removidas de `clickup_vinculos`).** Typecheck limpo, 152 testes.

**Rodado em produção (2026-07-28), via Console do Easypanel:** SeaBox — 2 criados. Meu Depósito
— 8 criados, 2 pulados por sobreposição (04/05 e 08/10, exatamente como previsto no dry-run).
Serviços de Espaço — 7 criados, 9 pulados por sobreposição (a complexidade real do Seaway Center,
também consistente com o dry-run); Sala de Treinamento teve histórico real em produção (o dev DB
não tinha nenhum). Nenhum erro; resultados batem com a validação prévia.

**Correção seguinte, mesmo dia — relaxar o bloqueio de criação pra aviso, agora que o push
protege de verdade.** Usuário perguntou "algo ficou pendente?" depois de rodar os 4 scripts em
produção. Resposta expôs um gap real: Serviços de Espaço - Seaway Center só tinha 4 das ~13 salas
específicas vinculadas (Auditório, Atendimento 04, Cabine, Sala de Treinamento) — as outras 9
salas + "Pacote de Horas" foram PULADAS na criação por sobreposição, mesmo tendo receita própria
limpa em outras linhas, porque `criarVinculoAction` ainda bloqueava a criação INTEIRA ao achar
qualquer sobreposição no histórico (comportamento de antes do push ganhar proteção real). Como
`linhasExclusivasDoVinculo` já garante que o push nunca dobra valor de linha combinada, esse
bloqueio na criação virou desnecessariamente conservador — só impedia rastrear receita que já
seria contabilizada corretamente de qualquer forma.

**Mudança:** `criarVinculoAction` (`actions.ts`) não bloqueia mais por sobreposição — cria o
vínculo e devolve um aviso informativo (mesmo padrão do aviso de "sem histórico" já existente,
não um erro). `scripts/seed-clickup-servicos-espaco.mjs` atualizado do mesmo jeito: cria mesmo com
sobreposição, loga quantas linhas são compartilhadas com um vínculo mais antigo. Essa mudança é
genérica (vale pra qualquer categoria via a tela admin), não só Seaway Center — mas só o script de
Serviços de Espaço foi alterado nesta rodada; os scripts de Salas Privativas/Meu Depósito
continuam pulando suas poucas sobreposições conhecidas (3 e 2 respectivamente), ficando como
follow-up opcional caso o usuário queira recuperar essas também.

**Validado com dado real, dry-run duplo (idempotência) contra o dev DB — agora cria os 16
vínculos completos** (antes só 7). **Prova concreta de que a proteção funciona:** somando os 16
vínculos coexistindo SEM a correção do push (simulação), o total ingênuo dava R$66.936,32 — mais
que o DOBRO do real; com `linhasExclusivasDoVinculo`, a soma corrigida bate EXATO com o total real
das faturas da categoria (R$30.561,99, ao centavo). Vínculos de teste removidos do dev DB depois.
Typecheck limpo, 152 testes.

**Rodado em produção (2026-07-28), via Console do Easypanel, depois do redeploy:** 9 criados
(Atendimento 01/02/03/05, Reunião 01/02/03/04, Pacote de Horas), 7 já existiam (idempotente) — os
16 vínculos completos de Serviços de Espaço agora ativos nas 3 unidades. Nenhum erro; contagens
batem exatamente com o dry-run.

**Status:** aceito, rodado em produção. Cobertura completa de Serviços de Espaço (16/16 vínculos
mapeados) e de todas as categorias que já têm tarefa correspondente no ClickUp — só Outros
Serviços e Hub Empreendedoras seguem sem cobertura, por falta de tarefa na lista Eficiência (não é
algo resolvível pelo dashboard).

## ADR-0026 — Metas: mensal volta a existir, ao lado do trimestral (séries independentes)

**Contexto:** a ADR-0022 tinha trocado meta mensal por trimestral (2026-07-24, alinhado com a
Duda). Usuário pediu agora que as duas convivam, "visíveis/configuráveis" — não uma substituindo
a outra.

**Decisão de produto confirmada com o usuário (`AskUserQuestion`) antes de tocar schema:** mensal
e trimestral são **séries independentes**. Trimestre NUNCA é calculado como soma dos 3 meses, nem
mês é um rateio do trimestre — cada um é um número que alguém define direto. Motivo: evita
inconsistência quando só parte dos meses de um trimestre tem meta, ou quando a soma dos 3 meses
não bate com o que alguém quis definir pro trimestre. Semestre/ano continuam somando só
TRIMESTRES contidos, exatamente como antes — mês nunca soma pra cima, fica só na própria visão
mensal do Panorama.

**Achado que confirmou ser seguro redesenhar o schema livremente:** o banco (dev e produção)
tinha **0 linhas em `meta_periodos`** — nenhuma meta de VALOR foi definida desde a virada pra
trimestral (só `meta_escopos`/`meta_escopo_categorias` têm dado real). Migration não precisou
preservar nem migrar nenhum valor.

**Modelo:** novo enum `MetaGranularidade` (`MES` | `TRIMESTRE`); `MetaPeriodo.anoTrimestre`
virou `periodoChave` (String) + `granularidade` (a coluna nova). Unique composto
`[escopoId, granularidade, periodoChave]` — a mesma chave textual nunca colide entre as duas
granularidades porque os formatos são mutuamente exclusivos por desenho: `"yyyy-MM"` (mês) nunca
tem "-Q", `"yyyy-Q#"` (trimestre) sempre tem. CHECK constraint composto na migration garante isso
no banco, não só na action (mesmo padrão de rigor da coluna anterior). Migration
`20260728000000_metas_mensal_e_trimestral` — `DROP COLUMN`+`ADD COLUMN` (não rename, como da vez
passada) porque o significado da coluna mudou de verdade.

**Lógica (`src/lib/metas/periodo.ts`/`metas.ts`):** `granularidadeDoKind(kind)` mapeia o
`PeriodKind` do Panorama pra granularidade de meta (`month` → `MES`; `quarter`/`semester`/`year`
→ `TRIMESTRE`; `day`/`week` → `null`, continuam sem meta — nenhuma granularidade responde por um
recorte tão fino sem inventar dado). Novo par `mesDaData`/`mesesDoPeriodo` espelha
`trimestreDaData`/`trimestresDoPeriodo`; `chavesDoPeriodo`/`chaveDaData` escolhem qual par usar
sem `metas.ts` precisar saber a diferença. `buildMetas` generalizado pra somar pela granularidade
resolvida em vez de sempre trimestre — a mesma lógica de recorte parcial ("nem todos os períodos
do intervalo têm meta") continua valendo, agora genérica pra mês ou trimestre.

**UI:** `/metas` ganhou um alternador Mensal/Trimestral no formulário (troca os campos Mês↔
Trimestre, nunca os dois juntos — usa `key` no `<form>` pra resetar o estado não-controlado dos
selects ao trocar, sem duplicar Server Action no mesmo form, gotcha já documentado neste projeto).
A tabela por escopo agora mostra duas seções (Trimestral / Mensal) em vez de uma. O card de metas
do Panorama (`metas-panel.tsx`) usa a palavra certa ("mês"/"trimestre") conforme
`metas.granularidade`; a mensagem de "não aplicável" (dia/semana) agora oferece os dois atalhos
("Ver por mês" e "por trimestre").

**Validado com dado real:** script duplicando a agregação (mesmo padrão dos scripts de seed do
ClickUp) criou uma meta mensal (R$1.000, Julho/2026) e uma trimestral (R$5.000, Q3/2026) pro
mesmo escopo real no dev DB — confirmou que a constraint composta aceita as duas coexistindo, e
que cada uma é lida isoladamente pela sua própria chave, nunca cruzando. App subido de verdade
(`npm run dev`, sessão JWT criada à mão): `/metas` renderizado com o alternador Mensal/Trimestral
visível; Panorama em `?g=month` agora mostra o card de metas (antes só dizia "meta é trimestral");
`?g=week` mostra a mensagem "mensal ou trimestral" com os dois links. Sessão de teste e processo
de dev removidos depois. Typecheck limpo, 161 testes (34 novos/reescritos em `periodo.test.ts`).

**Status:** aceito. Migration aplicada no dev DB; ainda não commitado nem rodado em produção.
