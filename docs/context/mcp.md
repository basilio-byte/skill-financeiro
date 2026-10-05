# MCP do Dashboard Financeiro

Servidor MCP (Model Context Protocol) que deixa um cliente de IA — Claude Code, Claude Desktop —
**consultar** o painel e **operar** o que a tela já permite operar. Decisões em [ADR-0033](decisions.md).

> **Escopo, por decisão do dono (2026-10-05):** consulta + escrita controlada sobre os DADOS.
> **Desenvolvimento (editar código, deploy) NÃO é feito por aqui** — continua no Claude Code, com git,
> testes e revisão. O MCP entrega o que o código não tem: o estado vivo de produção.

## Endereço e acesso

```
POST /api/mcp          (JSON-RPC 2.0 sobre HTTP, sem estado, sem SSE)
Authorization: Bearer shf_…
```

- **Só token pessoal** (`shf_…`), criado em **Minha conta → Tokens do MCP**. O valor aparece **uma vez**; o banco
  guarda só o SHA-256. Perdeu? Revogue e crie outro. Não existe token "master" por variável de ambiente.
- **Sem nenhum token criado, a rota responde 503.** Um deploy que esquece de criar token não vira endpoint aberto.
- A pessoa é conferida **a cada chamada**: usuário desativado derruba os tokens na hora; quem vira VIEWER perde a
  escrita no mesmo instante. VIEWER só emite token de leitura.
- Nenhuma ferramenta cria token (um token vazado não pode emitir outros).
- `MCP_SOMENTE_LEITURA=on` remove toda escrita de `tools/list` **e** recusa a chamada direta com o motivo.
- A rota está **fora** do gate de sessão do middleware (autentica por conta própria).

Registrar (a tela mostra o comando pronto, com o token, no momento da criação):

```bash
claude mcp add --transport http --scope local seahub-financeiro \
  https://financeiro.seahubcoworking.com.br/api/mcp \
  --header "Authorization: Bearer $TOKEN"
```

`GET /api/mcp` com o token devolve o cartão de visita (identidade, escopo e a MESMA lista de `tools/list`).

## Ferramentas

**Comece sempre por `estado_do_sistema`.** Com a receita parada, todo total é um retrato antigo.

### Consulta (17, somente leitura)

| Ferramenta | Para quê |
|---|---|
| `estado_do_sistema` | Saúde da receita (saudável/PARADA e a causa), última rodada concluída, o que há por mês de crédito, inadimplência, interruptores |
| `listar_rodadas`, `detalhar_rodada` | Histórico de sincronizações, erros, conferência |
| `panorama` | O mesmo da tela: total por período, categoria, conta, confiança, tendência |
| `agregar_receita` | Soma/contagem por categoria, conta, unidade, mês, dia, rateio, revisada ou status |
| `buscar_linhas`, `detalhar_fatura` | Linhas individuais (paginadas) e uma fatura inteira com itens e valores originais |
| `fila_de_revisao` | Rateadas / sem item pendentes de revisão |
| `listar_regras`, `servicos_sem_categoria` | Regras de categoria e o que falta mapear |
| `consultar_metas`, `historico_de_metas` | Realizado × meta e quem mudou o quê |
| `listar_conflitos` | Possível dupla contagem, classificada (resolvível ou ambíguo) |
| `consultar_inadimplentes` | Cobranças vencidas (API v2 do Conexa, separada da receita) |
| `verificar_integridade` | Checagens de consistência do BANCO (sem data, mês divergente, negativos, soma ≠ fatura) |
| `descrever_banco` | Tabelas, colunas e contagens — só metadados |
| `auditoria_mcp` | Quem chamou o quê, quando, com o estado anterior das escritas |

### Escrita (8, só com token de ESCRITA cujo dono é ADMIN)

| Ferramenta | Proteção |
|---|---|
| `disparar_sincronizacao` | Período iniciado antes do mês corrente exige `confirmarMesFechado` (recategoriza o mês com as regras de hoje). Hoje **falha por captcha** (ver abaixo) |
| `revisar_linha` | Valor decimal com ponto; snapshot original só na 1ª revisão; revisão congelada contra sincronização |
| `salvar_regra_categoria`, `alternar_regra_categoria` | Só `trim`: espaço duplo interno é preservado (porta exata da skill) |
| `definir_meta` | Regravar o mesmo valor não gera evento; histórico por mudança |
| `remover_meta` | Exige `confirmarRemocao`; guarda valor e histórico apagado em cascata |
| `resolver_conflito` | Só os resolvíveis; **recusa os ambíguos** |
| `excluir_linha` | Exige `confirmarExclusao`; guarda a linha inteira (sem `raw`) na auditoria |

Todos os esquemas são **fechados**: campo desconhecido é erro, e a ferramenta não executa.

## Auditoria

Toda chamada grava uma linha em `auditoria_mcp`: pessoa + token, ferramenta, argumentos, resultado
(`ok`/`erro`/`invalida`), duração e, nas escritas, o **estado anterior** em `detalhe`. Tentativas de
escrita recusadas por falta de escopo também ficam registradas. Nenhum token aparece lá.

## O que o agente precisa saber (já está nas instruções do `initialize`)

1. A receita depende do login web do Conexa, que passou a exigir **reCAPTCHA** (2026-10-05). Enquanto isso
   valer, `disparar_sincronizacao` falha — sem insistir e **sem tentar contornar**. Inadimplência usa a API v2
   e não é afetada.
2. Reprocessar um mês fechado **recategoriza** com as regras de hoje: o total pode não mudar, mas a quebra por
   categoria e as metas mudam. Avisar o usuário antes.
3. `negotiated` não é inadimplência (é a cobrança substituída; contá-la dobra a dívida).

## Dívida técnica declarada

As escritas **replicam** a lógica das ações da tela (`categorization/actions.ts`, `metas/actions.ts`,
`conflitos-actions.ts`) em vez de chamá-las, para não alterar o que está em produção. Se uma regra de uma
delas mudar, mude também em `src/lib/mcp/ferramentas/escrita.ts`.

Achado colateral **não corrigido** (fora do escopo): em `metas/actions.ts` a tela compara
`Decimal.toString()` (`"35000"`) com `"35000.00"`, então "regravar o mesmo valor" sempre gera um evento
de histórico falso. A versão do MCP compara numericamente.

## Cabeçalhos aceitos para o token (conector da claude.ai)

O conector personalizado da **claude.ai** reserva `authorization` ao fluxo OAuth (o campo não deixa escolhê-lo)
e só oferece nomes como `x-api-key`. O servidor aceita o token em `Authorization: Bearer`, `x-mcp-token`,
`x-api-key`, `api-key`, `apikey`, `x-apikey`, `x-api-token`, `api-token` e `x-auth-token`, com ou sem o prefixo
`Bearer`. Para a claude.ai: URL `…/api/mcp`, cabeçalho `x-api-key`, valor = o token. Quem autentica continua sendo
o token (prefixo `shf_` + SHA-256 no banco), seja qual for o cabeçalho.

`GET` com `Accept: text/event-stream` (cliente esperando SSE) responde **405**, como manda a especificação para
servidores sem SSE; o cliente segue só com POST. (`credencial.ts`, 15 testes.)
