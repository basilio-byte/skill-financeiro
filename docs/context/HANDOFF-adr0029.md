# ADR-0029 — status e pendências (não é mais preciso reestudar a causa)

Escrito em 2026-08-04. **A correção em si está CONCLUÍDA e validada em produção** (ver seção
"Status" abaixo). O que resta são achados colaterais que precisam de decisão da Duda, não código.
Fonte completa: ADR-0029 em `decisions.md`, estado ANTES em `snapshot-antes-2026-08-04.md`,
histórico completo (Fases 0 a 3) em `progress.md`.

## Status (2026-08-04, atualizado após a Fase 3)

**Deployado e confirmado em produção:** commits `f35bf78`/`9048256` (+ `a751e5b`) enviados,
GitHub Actions publicou a imagem, Easypanel subiu limpo. Sincronização manual de julho rodada em
produção: **`totalRecebido` = R$ 376.965,94, exato** (histórico em `/runs` confirma). A Fase 2
(validação contra cópia real de produção, com as 29 linhas revisadas manualmente) também passou —
detalhe em `progress.md`. **Não há mais nada pendente de código para a ADR-0029 propriamente
dita.**

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

## Fases 2 e 3 — CONCLUÍDAS (2026-08-04)

**Fase 2** (validar contra cópia real de produção): porta do Postgres exposta temporariamente
(autorização explícita do usuário), `pg_dump -Fc` completo (produção é PG 17.10, precisa do
client `postgres:17-alpine`), restaurado num container PG17 descartável (já removido). O obstáculo
do 307/login foi contornado chamando `startCategorizationRun` direto via `tsx` (função pura, sem
HTTP) — precisa de `NODE_OPTIONS="--conditions=react-server"` pra `import "server-only"` não
lançar fora do bundler do Next. As 4 conferências pedidas passaram: julho exato, reconciliação
zero, as 29 linhas manuais idênticas byte a byte, zero linhas apagadas — inclusive num teste extra
de janela cruzando meses (o cenário exato dos 2 bugs críticos). Detalhe completo em `progress.md`.

**Fase 3** (rodar em produção de verdade): push feito, deploy confirmado limpo, sincronização
manual de 01/07 a 31/07 rodada em produção — **`totalRecebido` = R$ 376.965,94, exato** (visível
no histórico de `/runs`). **A ADR-0029 está tecnicamente concluída.**

## Pendências abertas (decisão da Duda, não código)

O Panorama de julho mostra **R$ 378.063,86** — R$ 1.097,92 A MAIS que o R$ 376.965,94 real. Isso
**não é bug**: o Panorama soma a tabela persistida direto sem dedup (ADR-0013), e há 4 faturas em
`/conflitos` com duas linhas coexistindo (uma manual, uma automática) que ainda não foram
resolvidas. A diferença bate exato: 75,00 + 25,00 + 64,50 + 933,42 = 1.097,92.

1. **17132/17133 (já conhecidas, não são erro de dinheiro):** categoria mudou de mês pra mês
   (revisão humana em julho vs. regra em agosto). A Duda decide qual fica.
2. **15734/15476 (novas, achado desta sessão) — CORREÇÃO: não são `manual_superada`, são
   `ambiguo`.** Eu tinha classificado errado antes de ver o resultado real em produção —
   `classificarConflito` (`src/lib/categorization/classificar-conflito.ts`) só oferece resolução
   automática quando a categoria manual e a automática CONCORDAM; aqui elas DIVERGEM (ex.: manual
   "Salas Privativas - Seaway Center" vs. automática "Serviços de Espaço - Sebrae"), por isso não
   tem botão de um clique — é decisão de negócio mesmo. As duas faturas têm
   `servicoOuPlano = "Cliente Avulso"` — investigação com
   `node scripts/diagnostico-cliente-avulso.mjs "Cliente Avulso"` (ou o `node -e` equivalente, se o
   script ainda não foi commitado/deployado) mostrou **13 linhas / só 4 clientes reais**, e **9
   dessas 13 (69%) já estão categorizadas como "Serviços de Espaço - Sebrae" sem NENHUMA revisão
   manual concorrente pra contestar** — ou seja, podem estar erradas do mesmo jeito que 15476/15734,
   só que silenciosamente (sem revisão manual pra comparar, `/conflitos` nunca acusa). Nenhum dos 4
   clientes reais (EMR Terapia Ocupacional, Vox Áudio e Mídias, Fernanda Coelho Paiva Serviços
   Médicos, Veritas) parece ter relação óbvia com "Sebrae". **Recomendado à Duda:** conferir a
   regra "Cliente Avulso" → "Serviços de Espaço - Sebrae" em `/categorias` — provavelmente "Cliente
   Avulso" não deveria ter regra automática nenhuma, já que é um nome de plano genérico usado por
   clientes sem relação entre si (o mesmo risco que a ADR-0020 já tinha documentado).

## Depois, e só depois

- **Backfill de junho e anteriores — agora SEGURO** (a correção já está no ar): antes da ADR-0029,
  sincronizar junho puxaria as recorrentes de volta e as arrancaria de julho/agosto; com
  `mesCredito` na chave, cada mês guarda a sua parcela. Ainda assim, recomendado resolver as 4
  pendências acima primeiro, pra não somar mais confusão em cima de conflitos já abertos.

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
