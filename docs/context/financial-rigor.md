# Rigor financeiro

Regras herdadas do projeto irmão (`seahub_financeiro`) + as específicas deste pipeline.

1. **Dinheiro nunca em `number`/float.** Toda soma/multiplicação de valores passa por
   `src/lib/money.ts` (Decimal.js). Persistência sempre `Decimal(14,2)`.
2. **Nunca confiar em número "solto" vindo do export do Conexa sem checar o formato.**
   O export mistura, na MESMA coluna, valores <1.000 como float cru (`"87.5"`) e valores
   >=1.000 como texto BR com separador de milhar (`"1.328,62"`) — já zerou faturas grandes
   silenciosamente em um exercício anterior da equipe. `parseMoneyCell()` em
   `src/lib/xlsx/reader.ts` decide o formato pela presença de vírgula — não simplificar isso.
3. **"Data de Crédito da Cobrança" não é um campo da API REST do Conexa** — só existe
   como filtro na tela de export administrativa (login web). Ver `conexa-integration.md`.
   Nunca tentar "descobrir" esse valor computando a partir de outro campo — se o export não
   trouxer, o campo fica vazio, não se estima.
4. **Exceção documentada ao princípio "nunca chutar categoria pelo nome"** (que o projeto
   irmão segue à risca — ADR-0014/ADR-0019 de lá). Aqui, a categorização é INTENCIONALMENTE
   por correspondência de nome/prefixo contra `RevenueCategoryRule` — mas essa tabela é
   validada e mantida pelo time financeiro (Duda), não um palpite de código. Ver ADR-0002.
5. **Toda linha categorizada guarda `raw`** (JSON bruto da fatura/CR de origem) para
   auditoria e reprocessamento, mesmo padrão do projeto irmão.
6. **Rateio proporcional fecha exato.** `allocateProportionally()` sempre distribui o
   resíduo de arredondamento na última parcela — a soma de "Valor Recebido Cat." de uma
   fatura sempre bate com "Valor Recebido Total".
7. **Conferência de toda rodada:** soma de `Valor Recebido Cat.` deve igualar a soma de
   `Valor Recebido` do Contas a Receber filtrado. Diferença normalmente indica fatura com
   Data de Crédito fora do período pedido incluída no export (checar filtro).
8. **Falha de rodada nunca é silenciosa.** `RevenueSyncRun.status = FAILED` + `erro`
   preenchido sempre que fetch/parse/categorização/persistência falhar — nunca deixar uma
   rodada "sumir" sem rastro. Isso inclui rodadas travadas: se o processo morrer no meio de
   uma sincronização, a rodada RUNNING é recuperada (marcada FAILED com o motivo) na próxima
   tentativa, depois de um tempo — nunca fica presa em RUNNING para sempre bloqueando todas
   as sincronizações futuras (ver ADR-0013, `RODADA_TRAVADA_MS` em `run.ts`).
9. **Regra permanente (2026-07-21, pedido explícito do usuário): tudo — cálculo, categoria,
   valores, dashboard — segue a skill `categoriza-receita` à risca. A ÚNICA exceção é dado
   ajustado manualmente ("revisado") em `/runs/[id]` ou `/revisar`.** Mesmo essa exceção é
   rastreada, nunca uma sobrescrita silenciosa: `RevenueCategorizedLine.revisadoManualmente`/
   `revisadoPorId`/`revisadoEm` registram a revisão, e `categoriaOriginal`/
   `valorRecebidoCatOriginal` guardam o valor que a skill calculou ANTES da primeira revisão
   (nunca sobrescritos em revisões seguintes — é a referência permanente de "o que o
   algoritmo disse"). Isso significa: nenhum código de agregação/relatório deve "corrigir" ou
   reinterpretar o output da skill por conta própria — só o humano, explicitamente, via a
   tela de revisão. (Desde a ADR-0013, uma `RevenueSyncRun` NÃO recalcula mais seu próprio
   `resumoPorCategoria`/`totalRecebido` quando uma linha é revisada — esse número é um
   snapshot congelado do que a rodada calculou no momento; os valores ao vivo, já com
   revisões, vêm do Panorama e de `/revisar`, que consultam as linhas atuais direto.)
10. **Upsert por fatura: cada bucket de categoria tem UMA linha atual, nunca linhas novas a
    cada sincronização — e a proteção da revisão manual vem do próprio upsert, não de uma
    escolha de "vencedor" na leitura.** (ADR-0013, substituiu o mecanismo de deduplicação
    por leitura da ADR-0012 depois que o usuário revelou a intenção de sincronizar
    automaticamente a cada 15 minutos — um modelo append-only cresceria sem limite nessa
    cadência.) `RevenueCategorizedLine.chaveLinha` é a identidade estável de um bucket
    (a categoria que a SKILL calculou, nunca a que uma revisão manual sobrescreveu depois —
    ver `chaveLinhaDoBucket()` em `categorize-invoices.ts`), e `@@unique([crConexaId,
    chaveLinha])` garante que existe só uma linha por bucket a qualquer momento —
    sincronizar o mesmo período (ou um que se sobrepõe) 3x atualiza a MESMA linha 3x, nunca
    soma. `persistLinhasCategorizadas()` (`src/lib/categorization/persist.ts`) faz o upsert:
    quando a linha existente já está `revisadoManualmente`, `categoria`/`valorRecebidoCat`
    são omitidos do update (nunca sobrescritos — regra 9); todo o resto (datas, status,
    `raw`) continua atualizando normalmente, porque são dados factuais do Conexa, não
    decisões da skill. Uma linha cujo bucket desaparece de uma rodada nova é apagada —
    EXCETO se `revisadoManualmente`, caso em que é preservada e contada (nunca some
    silenciosamente — regra 8). Views de UMA rodada específica (`/runs/[id]`) mostram só o
    que ELA tocou por último (`ultimaRodadaId`) — não são mais "o registro completo daquela
    execução" como no modelo antigo; para o que precisa de revisão em todo o sistema, use
    `/revisar`. O Panorama (`overview.ts`) consulta as linhas atuais direto, sem SQL
    especial de deduplicação.
11. **A proteção da revisão manual (regra 9) só funciona de verdade se os DOIS lados forem
    transações Serializable — achado real por verificação adversarial (2026-07-21) contra a
    primeira versão da ADR-0013.** `persistLinhasCategorizadas()` lê `revisadoManualmente`,
    decide o que proteger/apagar e grava tudo — leitura, delete de órfãs e todos os
    upserts — dentro de UMA ÚNICA transação Serializable. Isso sozinho não bastaria: se
    `updateCategorizedLineAction` (a revisão manual em si) rodasse fora de uma transação
    Serializable também, o Postgres não teria como detectar o conflito entre as duas, e uma
    revisão feita bem no meio de uma sincronização em andamento podia ser silenciosamente
    sobrescrita (ou, no caso de uma linha órfã, até apagada) segundos depois de salva — por
    isso `updateCategorizedLineAction` TAMBÉM roda em Serializable (mesmo padrão de
    `inSerializableGuard` em `auth/user-actions.ts`), tratando o conflito real (Postgres
    P2034) como "tente novamente", nunca aplicando a revisão pela metade.
    **Risco residual documentado, não eliminado:** uma linha revisada manualmente cujo bucket
    (`chaveLinha`) some de uma rodada (ex.: a categoria "adivinhada" à mão ganha depois uma
    regra de verdade em `RevenueCategoryRule`) é preservada — nunca apagada, regra 9 — mas a
    rodada seguinte cria um bucket NOVO com a categoria correta, e as duas linhas juntas
    contam a mesma receita duas vezes. Não é possível resolver isso automaticamente sem
    decidir qual das duas versões é a certa — decisão que só um humano pode tomar. Em vez de
    tentar adivinhar, `persistLinhasCategorizadas()` confere a soma das linhas de toda fatura
    afetada contra o valor total dela e, se não bater, conta em
    `RevenueSyncRun.totalFaturasComConflito` e loga um erro explícito — nunca silencioso
    (regra 8), mas também não autocorrigido. Aparece em `/runs/[id]` como um alerta visível.
