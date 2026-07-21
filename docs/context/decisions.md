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
uma métrica financeira do período).
**Status:** aceito.
