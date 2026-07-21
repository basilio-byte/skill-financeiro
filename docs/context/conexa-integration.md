# Integração com o Conexa

**Não é a API REST v2** (essa é a que o projeto irmão `seahub_financeiro` usa, via
`CONEXA_API_TOKEN` Bearer). Aqui usamos a tela ADMIN (web) do Conexa, porque só ela expõe o
filtro "Data de Crédito da Cobrança" que o financeiro precisa para fechar o período de uma
rodada — confirmado por busca exaustiva na coleção Postman da API v2 (não existe esse
filtro lá) e validado ao vivo contra `seahubcoworking.conexa.app` em 2026-07-21.

## Login

`POST {CONEXA_BASE_URL}/index.php?r=site/login`
Body (`application/x-www-form-urlencoded`): `LoginForm[username]`, `LoginForm[password]`,
`LoginForm[rememberMe]=0`, `token=` (vazio — não há CSRF token nem recaptcha nesse form).
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
