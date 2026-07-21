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
8. **Falha de rodada nunca é silenciosa.** `RevenueCategorizationRun.status = FAILED` +
   `erro` preenchido sempre que fetch/parse/categorização falhar — nunca deixar uma rodada
   "sumir" sem rastro.
