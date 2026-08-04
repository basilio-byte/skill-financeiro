# Estado ANTES — produção, 2026-08-04T14:35:30Z

Registro oficial do estado de `revenue_categorized_lines` **antes** da ADR-0029 (a chave da linha
passar a incluir o mês do crédito). Exigido pelo usuário para permitir reversão.

Gerado por `scripts/snapshot-antes.mjs` (somente leitura) no Console do serviço da aplicação.
Transcrito da saída real, sem edição de números.

**Backup binário correspondente:** `/tmp/antes-adr0029-2026-08-04.dump` — 313K, criado com
`pg_dump -U postgres -d odoo -t revenue_categorized_lines -F c` na aba **Bash** do serviço do
Postgres (não na "Postgres Client": `pg_dump` é comando de shell e o psql não o executa — a
primeira tentativa falhou silenciosamente por isso).

> `/tmp` do container não sobrevive a uma recriação, e um deploy recria o container. Se este dump
> for necessário depois, ele precisa ser copiado para fora antes do próximo deploy.

## 1. Totais gerais

| | |
|---|---|
| linhas | 1406 |
| faturas distintas | 1196 |
| soma `valorRecebidoCat` | **R$ 443.053,63** |
| linhas sem `dataCredito` | 0 |
| **revisadas manualmente** | **29** |

As 29 linhas revisadas manualmente são o dado mais sensível aqui: são correções humanas e não
podem ser perdidas nem na correção nem numa eventual reversão (financial-rigor #9). Em
desenvolvimento esse número é 0, então nenhum teste local exercita esse caminho — é um motivo a
mais para a validação da Fase 2 ser feita contra uma cópia do dado real.

## 2. Por mês de `dataCredito` — **a conferência principal do antes/depois**

| mês | linhas | faturas | total |
|---|---|---|---|
| 2026-06 | 107 | 94 | R$ 44.572,10 |
| 2026-07 | 1182 | 1001 | **R$ 375.868,87** |
| 2026-08 | 117 | 103 | R$ 22.612,66 |

Duas confirmações independentes cruzando com o que já sabíamos:

- **Julho = R$ 375.868,87**, exatamente o KPI da tela que a Duda contestou. O Conexa diz
  R$ 376.965,94 — diferença de R$ 1.097,07, as 10 faturas que migraram para agosto (ADR-0029).
- **Junho = R$ 44.572,10**, exatamente o que eu havia calculado por subtração antes de ter acesso
  ao banco (R$ 324.240,12 do arquivo do Conexa menos os R$ 279.668,02 que o diagnóstico acusou
  como faltantes). Junho nunca foi ingerido — o app começou em julho.

## 3. Por mês × categoria

### 2026-06 — soma R$ 44.572,10 ✅ (fecha com a seção 2)

| linhas | total | categoria |
|---|---|---|
| 72 | R$ 10.970,05 | Endereço Fiscal |
| 6 | R$ 18.499,00 | Salas Privativas - Seaway Center |
| 19 | R$ 5.536,10 | Serviços de Espaço - Seaway Center |
| 3 | R$ 7.041,20 | Salas Privativas -  Ayrton Senna |
| 1 | R$ 2.000,00 | Salas Privativas -  Sebrae |
| 5 | R$ 505,00 | Outros Serviços |
| 1 | R$ 20,75 | SeaBox |

### 2026-07 — soma R$ 375.868,87 ✅ (fecha com a seção 2), 1182 linhas ✅

| linhas | total | categoria |
|---|---|---|
| 757 | R$ 113.146,23 | Endereço Fiscal |
| 58 | R$ 148.138,11 | Salas Privativas - Seaway Center |
| 229 | R$ 43.880,25 | Serviços de Espaço - Seaway Center |
| 9 | R$ 26.552,80 | Salas Privativas -  Sebrae |
| 15 | R$ 17.856,11 | Salas Privativas -  Ayrton Senna |
| 21 | R$ 10.307,25 | Serviços de Espaço -  Sebrae |
| 57 | R$ 8.057,26 | Outros Serviços |
| 8 | R$ 6.732,03 | Meu Depósito |
| 8 | R$ 666,35 | Hub Empreendedoras |
| 17 | R$ 497,48 | SeaBox |
| 3 | R$ 35,00 | Serviços de Espaço -  Ayrton Senna |

Julho não tem nenhuma linha "Sem Categoria" — bate com o KPI "Sem categoria no período: R$ 0,00".

### 2026-08 — soma R$ 22.612,66 ✅ (fecha com a seção 2), 117 linhas ✅

| linhas | total | categoria |
|---|---|---|
| 83 | R$ 14.489,96 | Endereço Fiscal |
| 2 | R$ 4.606,60 | Salas Privativas - Seaway Center |
| 22 | R$ 2.792,53 | Serviços de Espaço - Seaway Center |
| 3 | R$ 219,71 | Outros Serviços |
| 2 | R$ 186,60 | Hub Empreendedoras |
| 1 | R$ 165,00 | Sem Categoria |
| 3 | R$ 100,00 | Serviços de Espaço -  Sebrae |
| 1 | R$ 52,26 | SeaBox |

*(Conferi as três somas de categoria contra os totais da seção 2 e as contagens de linha contra a
seção 1: fecham exatamente. O snapshot é internamente consistente.)*

## 4. Faturas que aparecem em mais de um mês: **2** — e são a prova do desenho

Em desenvolvimento esse número é 0 — a linha é sobrescrita, então uma fatura só pode estar num
mês. As 2 de produção são as cobranças 17132 e 17133, que na análise do arquivo da Duda tinham
data de agosto já alcançada e, ao contrário das outras 10, **não** migraram. Consulta direta:

| crConexaId | dataCredito | valor | categoria | chaveLinha |
|---|---|---|---|---|
| 17132 | 2026-07-02 | 75,00 | Outros Serviços | `Sem Categoria` |
| 17132 | 2026-08-02 | 75,00 | Serviços de Espaço -  Sebrae | `Serviços de Espaço -  Sebrae` |
| 17133 | 2026-07-02 | 25,00 | Outros Serviços | `Sem Categoria` |
| 17133 | 2026-08-02 | 25,00 | Serviços de Espaço -  Sebrae | `Serviços de Espaço -  Sebrae` |

**Não é dupla contagem** — eu havia suspeitado que fosse, e está errado. As duas linhas têm
`chaveLinha` DIFERENTE, então são chaves diferentes e a rodada de agosto criou linha nova em vez
de sobrescrever a de julho. E como essas cobranças têm crédito em 02/07 **e** 02/08, R$ 75 em
julho e R$ 75 em agosto é o valor correto: são duas parcelas distintas.

O que aconteceu: em julho a skill não sabia mapear o serviço e caiu em "Sem Categoria" (é o valor
gravado em `chaveLinha`, que sempre guarda a categoria da SKILL, nunca a de uma revisão manual —
ADR-0013); um humano revisou a linha para "Outros Serviços"; depois alguém criou a regra em
`/categorias` e, em agosto, a skill passou a atribuir "Serviços de Espaço -  Sebrae". Categoria
diferente ⇒ `chaveLinha` diferente ⇒ chave diferente ⇒ julho sobreviveu.

**Estas duas já estão no comportamento que a ADR-0029 quer, por acidente.** É a melhor evidência
disponível de que o desenho funciona: quando a chave difere, os dois meses coexistem com o valor
certo. A coluna `mesCredito` só faz de propósito, para todas as recorrentes, o que aqui aconteceu
por efeito colateral de uma regra nova.

**Ponta solta para a Duda (não é erro de dinheiro):** o mesmo serviço está classificado como
"Outros Serviços" em julho e "Serviços de Espaço -  Sebrae" em agosto — a revisão humana de julho
e a regra de agosto discordam. Quem decide qual está certa é ela, não este trabalho.

## 5. Colisões sob a chave NOVA `(crConexaId, chaveLinha, mês)`: **NENHUMA**

Este era o risco de a migration falhar em produção — a mesma classe do incidente P3009 da
ADR-0026, em que uma migration foi validada só contra banco vazio e quebrou contra o dado real.
Está livre: o índice único novo pode ser criado sem conflito.

## 6. Impressão digital do inventário

| | |
|---|---|
| linhas no inventário | 1406 |
| sha256 | `8a8331e07156b67b5aee172e0754815e0990b9d5d29833173c8a63aba03cf3e0` |

O hash cobre `crConexaId;dataCredito;valorRecebidoCat;categoria;revisadoManualmente` de todas as
linhas, ordenadas. **Se depois de uma reversão este hash bater, o inventário voltou idêntico** —
sem precisar comparar 1406 linhas na mão. Para reproduzir: `node scripts/snapshot-antes.mjs`
(o dump linha a linha sai com `--completo`).
