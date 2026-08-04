# Retomada da ADR-0029 — leia só isto para continuar

Escrito em 2026-08-04, no fim de uma sessão. Objetivo: **retomar sem reestudar nada.**
Fonte completa: ADR-0029 em `decisions.md`, estado ANTES em `snapshot-antes-2026-08-04.md`,
histórico em `progress.md`.

## Onde o trabalho parou

**Dois commits LOCAIS, deliberadamente NÃO enviados:**

| commit | o que é |
|---|---|
| `f35bf78` | Fase 1 v1 — coluna `mesCredito` + chave única + migration |
| `9048256` | Fase 1 v2 — corrige os 2 bugs críticos que a revisão adversarial achou |

> **`git push` neste projeto dispara deploy automático em produção** (push → GitHub Actions →
> GHCR `:latest` → Easypanel puxa sozinho). Por isso não foi enviado: a Fase 2 não aconteceu.

Estado: typecheck limpo, **204 testes passando**, migration aplicada **só no dev**.

## O problema, em uma frase

Cobrança recorrente tem uma LISTA de datas de crédito (uma por parcela) e entrega o mesmo valor
em cada mês. A linha era chaveada por `(crConexaId, chaveLinha)`, **sem a data**, então a rodada
de agosto sobrescrevia a `dataCredito` da linha de julho: **a receita migrava de mês.**

Provado em produção: 10 faturas, R$ 1.097,07, **todas no dia exato** previsto pela lista de datas.

## Números para conferir (não recalcular)

| | valor |
|---|---|
| Julho no Conexa (arquivo da Duda, 1011 cobranças) | **R$ 376.965,94** |
| Julho no dashboard (o KPI que ela contestou) | **R$ 375.868,87** |
| Diferença = as 10 que migraram | **R$ 1.097,07** |
| Ainda vão migrar conforme agosto avança | 95 cobranças, **R$ 16.659,90** |
| Produção antes da correção | 1406 linhas, R$ 443.053,63, **29 revisadas manualmente** |
| Junho no banco / no Conexa | R$ 44.572,10 / R$ 324.240,12 |

Arquivos da Duda usados na análise (em `C:/Users/User/Downloads/`):
`Contas a receber - data credito.xlsx - Worksheet.csv` (julho) e
`Fechamento Seahub Junho 2026.xlsx - Data Credito.csv` (junho).

## Decisões já tomadas — não reabrir

1. **A "opção A" (escolher uma data determinística por fatura) foi APROVADA e depois DESCARTADA
   por evidência.** Cada data é uma PARCELA: 125 de 129 multi-data têm `Valor Recebido` =
   `Valor Bruto ÷ nº de datas`, e 115 das 116 faturas presentes em junho E julho têm valor
   idêntico nos dois. A opção A descartaria 11 de 12 parcelas de cada recorrente.
2. **A chave é o MÊS, não a data crua.** O Conexa exporta UMA parcela por cobrança mesmo com duas
   datas na janela (testado nos IDs 21864/21713/22538). Com a data crua, um sync manual de período
   diferente criaria uma segunda linha no mesmo mês e **dobraria** a receita.
3. **Limitação aceita e declarada:** 2 parcelas no mesmo mês contam como 1 — igual ao export do
   Conexa e ao fechamento da Duda. Acontece em 7 de 129.
4. **Junho nunca foi ingerido** (o app começou em julho, e o auto-sync só cobre o mês corrente).
   Não é bug. Confirmado pelo usuário.

## Os três bugs já encontrados e corrigidos — não reintroduzir

Todos travados em `src/lib/categorization/orfas.test.ts`.

1. **Janela cruzando dois meses apagava o mês que a rodada não emitiu.** A rodada só emite UMA
   parcela por fatura. **"Aplicar agora" em `/categorias` monta exatamente essas janelas.**
2. **Data corrigida de julho→agosto deixava a linha de julho inalcançável** (lixo eterno, dois
   meses contando a mesma receita). Regressão introduzida ao escopar a busca por mês.
3. **A regra nova, na primeira versão, não apagava o bucket que muda de categoria no mesmo mês** —
   dobraria a receita. Daí a distinção "mês coberto" vs "mês não coberto".

Regra final, em `orfas.ts` (`decidirOrfas`, puro e testado):

- mês que a rodada **cobriu** e a linha não foi produzida → órfã;
- mês que a rodada **não cobriu** → só é órfã se sumiu da lista de Data Crédito do Conexa;
- fatura ausente da rodada ou sem lista legível → julga só dentro da janela, silêncio fora.

## O que falta

### Fase 2 — validar contra cópia do dado real (BLOQUEIA o push)

Precisa ser com cópia de produção, não com o dev: **produção tem 29 linhas revisadas manualmente
e o dev tem 0** — o caminho que mais importa proteger não é exercitado localmente.

1. Restaurar o dump num banco isolado (ver "Backup" abaixo).
2. Aplicar a migration `20260804150000_mes_credito_na_identidade`.
3. Rodar uma sincronização de **julho** e depois uma de **agosto**, nessa ordem.
4. Conferir: julho volta a **R$ 376.965,94**, agosto não perde nada, as 29 revisadas manualmente
   continuam intactas, e nenhuma linha é apagada indevidamente (o `deleteMany` agora loga).

**Obstáculo conhecido:** o smoke test via `POST /api/runs` com sessão forjada respondeu **307 para
/login** — o caminho de auth da API difere do das páginas (a sessão forjada funciona em GET de
páginas: ver `scratchpad/mint.mjs`). Resolver isso, ou disparar a sincronização pela UI.

### Fase 3 — restaurar julho (depois do deploy)

Sincronização manual de 01/07 a 31/07, já com a correção no ar. Conferir contra R$ 376.965,94.

### Depois, e só depois

- **Backfill de junho e anteriores.** ⚠️ **NÃO fazer antes da correção**: hoje sincronizar junho
  puxaria as recorrentes de volta e as arrancaria de julho e agosto.
- Ponta solta para a Duda: faturas 17132/17133 estão como "Outros Serviços" em julho (revisão
  humana) e "Serviços de Espaço - Sebrae" em agosto (regra). Não é erro de dinheiro; ela decide.

## Backup e reversão

- **Dump:** `/tmp/antes-adr0029-2026-08-04.dump` (313K) no container do Postgres.
  ⚠️ **`/tmp` morre quando o container é recriado, e um deploy recria.** Se ainda não foi copiado
  para fora, **refazer o dump antes de qualquer deploy**:
  aba **Bash** do serviço do Postgres (não "Postgres Client" — `pg_dump` é comando de shell e o
  psql o ignora em silêncio; conferir sempre com `ls -lh`).
- **Números de conferência:** `node scripts/snapshot-antes.mjs` (somente leitura). O sha256 do
  inventário está no snapshot: se bater depois de uma reversão, voltou idêntico.
- **SQL de reversão:** na ADR-0029, seção "Estado ANTES e procedimento de reversão". Ordem
  obrigatória: apagar as linhas duplicadas sob a chave antiga (via `row_number()`, preferindo
  revisada manualmente > mês mais recente) **antes** de restaurar o índice antigo.

## Comandos úteis

```bash
# Conferência 3-vias contra o Conexa, por mês (somente leitura, no console da app)
node scripts/diagnostico-residuo-motor.mjs 2026-07
node scripts/conferencia-completa.mjs 2026-07

# Estado atual da tabela
node scripts/snapshot-antes.mjs

# Prisma CLI local precisa de 127.0.0.1, não localhost (IPv6)
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/localhost/127.0.0.1/')"
```
