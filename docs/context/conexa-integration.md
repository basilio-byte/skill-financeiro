# Integração com o Conexa

**Não é a API REST v2** (essa é a que o projeto irmão `seahub_financeiro` usa, via
`CONEXA_API_TOKEN` Bearer). Aqui usamos a tela ADMIN (web) do Conexa, porque só ela expõe o
filtro "Data de Crédito da Cobrança" que o financeiro precisa para fechar o período de uma
rodada — confirmado por busca exaustiva na coleção Postman da API v2 (não existe esse
filtro lá) e validado ao vivo contra `seahubcoworking.conexa.app` em 2026-07-21.

## Login

`POST {CONEXA_BASE_URL}/index.php?r=site/login`
Body (`application/x-www-form-urlencoded`): `LoginForm[username]`, `LoginForm[password]`,
`LoginForm[rememberMe]=0`, `token=` (vazio). **⚠ DESDE OUT/2026 O FORM TEM reCAPTCHA ENTERPRISE** (`data-action="LOGIN"`): o POST devolve `200` com o toast "Marque o captcha e tente novamente" em vez do `302`. Em jul/2026 não havia. Automação não resolve; ver ADR-0032.
Sucesso = `302` para `r=site/index` + cookie `CNXSESSID` (válido 2h, `Max-Age=7200`).
Credenciais: `CONEXA_WEB_USERNAME`/`CONEXA_WEB_PASSWORD` — **usuário/senha reais de login,
não o token de API.** Nunca commitar valores reais; só via secret do Easypanel/`.env` local.

## Exports

Ambos via `GET {CONEXA_BASE_URL}/index.php?...&export=excel`, com o cookie de sessão.
Retornam `.xlsx` real (OOXML), `Content-Type: application/vnd.ms-excel`.

- **Listar Vendas**: `r=venda/admin`, `ajax=venda-grid`. Período: `Venda[creditoFilterFirst]`
  / `Venda[creditoFilterLast]` (`dd/mm/yyyy`). 24 colunas confirmadas, incluindo
  `Serviço/Item`, `Categoria` (nativa do Conexa, grosseira), `Referência Cobrança`,
  `Crédito Cobrança`.
- **Contas a Receber**: `r=cobranca/admin`, `ajax=cobranca-grid`. Período:
  `Cobranca[dataCreditoFilterFirst]` / `Cobranca[dataCreditoFilterLast]` (`dd/mm/yyyy`).
  37 colunas confirmadas, incluindo `ID Cliente`, `CPF/CNPJ`, `Plano(s) Contratado(s)`,
  `Competência`, `Data Crédito`.

Ver `src/lib/conexa-web/client.ts` para os parâmetros fixos completos de cada URL.

## Coisas que já quebraram / cuidado

- Números BR mistos na mesma coluna (ver `financial-rigor.md` #2).
- `Data Crédito` pode vir como lista de datas separadas por vírgula para faturas
  recorrentes (visto em uma amostra antiga) — o parser usa a primeira data da lista.
- Sessão dura só 2h — cada rodada faz login do zero (não reaproveita sessão entre rodadas).
- Se o export voltar HTML em vez de xlsx (`content-type` sem "excel"/"spreadsheet"), é sinal
  de sessão expirada ou erro na tela do Conexa — tratado como falha explícita, nunca
  processado como se fosse a planilha.
- Esse mecanismo **não é uma API oficial/suportada** — se o Conexa mudar a tela admin, pode
  quebrar. Plano B (não implementado): pipeline de upload manual dos dois exports, que é
  como a skill OpenClaw original (`categoriza-receita`) funciona hoje.

## Importação manual (enquanto o login web exigir captcha) — ADR-0034

Em **Sincronizações → Importar arquivos do Conexa** (só administradores):

1. No Conexa, exporte (Excel) **dois relatórios com o MESMO filtro de Data de Crédito da Cobrança** e o mesmo
   período: **Contas a Receber** e **Listar Vendas**.
2. Envie os arquivos **exatamente como baixou** — não abra e salve no Excel (ele reescreve as datas e a estrutura;
   o sistema recusa esse arquivo).
3. Informe o período (o mesmo do filtro). Para fechar um mês, **exporte e importe o mês inteiro**: tudo que está
   dentro do período e não vem no arquivo é removido (revisões manuais nunca).
4. **Pré-visualizar** e conferir: o total do mês "hoje × depois", as linhas removidas e os alertas. Só então
   **Importar e categorizar** (com a caixa de confirmação, se a prévia pedir).

Limite: 4,5 MB por arquivo. Primeira vez: compare o total do mês da prévia com o fechamento da Duda.

## Atualização 2026-10-14 — o captcha saiu e o login automático voltou
- A página de login (`?r=site/login`) deixou de carregar o widget do reCAPTCHA (sem `g-recaptcha`, sem
  `data-sitekey`, sem script do Google; sobra uma regra de CSS órfã). Depois de reiniciar o serviço, a rodada
  automática das 16:18 UTC concluiu (437 faturas, R$ 121.863,79, conferência 0,00): a sincronização automática
  voltou. A importação manual (ADR-0034) fica como plano B.
- Por que só voltou ao reiniciar: a pausa de 6 h do login (em memória) segurava as tentativas — a última real
  (08:38 locais) ainda tinha sido recusada. Agora, com a pausa ativa, o sistema SONDA a página de login a cada
  ciclo (GET público, sem credenciais) e, se o widget SUMIU depois de a pausa começar, tenta uma vez
  (`podeLevantarPausa`). Se o servidor recusar mesmo sem widget, a pausa recomeça e NÃO é levantada por sondagem
  (evita voltar a bater a cada 15 min). Provado com um Conexa falso nos dois cenários.

## Atualização 2026-11-11 — o export de Contas a Receber passou a ser PAGINADO (ADR-0036)
- **O que mudou no Conexa (depois de 27/10):** `r=cobranca/admin&export=excel` devolve só a página atual da grade — 20
  linhas sem `itemsPerPage` — e `show_all=1` é ignorado. O Listar Vendas continua inteiro com `show_all=1`. O tamanho de
  página mudado numa sessão não vale para a próxima.
- **Como baixar tudo:** `itemsPerPage=100` (máximo; o seletor aceita 5/10/20/50/100) + `isChangeItemsPerPage=1` +
  `cobranca_page=N` (minúsculo — é o que o paginador da tela usa; `Cobranca_page`, `page`, `offset` etc. são ignorados) +
  `sort=id` (ordem total; a padrão tem empates). Cada página termina com uma linha de preenchimento (20 colunas, `&nbsp;`
  em "Valor" e "Valor Atual") que não é cobrança.
- **Como saber o total:** a grade HTML (mesma URL, sem `export`) com `page=1&0=&count=` — é o que o botão "Clique para
  exibir o total de itens" faz — traz `<div class="page-summary"><div>1-20 de N</div></div>`. Vale para `cobranca-grid` e
  `venda-grid`; grade vazia = `<td class="empty">` sem resumo; sem cookie = 302 para o login. A página tem ~1,7 MB.
- **Medidas de 11/11:** pico de cobranças por dia de crédito entre jul e nov/2026: 70, 100 (10/08), 74, 70 e 80; um mês tem
  ~940 a 1.010 cobranças (10 a 11 páginas). Uma página de 100 leva ~6 a 7 s para o Conexa gerar.
- **Importação manual:** o botão "Exportar" da tela entrega só a página visível (no máximo 100 linhas). Para um mês
  inteiro, o arquivo precisa ser gerado pelo sistema (o download paginado + conferido) — ver ADR-0036.
- Os scripts `scripts/conferencia-completa.mjs` e `scripts/diagnostico-residuo-motor.mjs` ainda usam o download antigo
  (sem paginação): hoje veriam o CR cortado.
