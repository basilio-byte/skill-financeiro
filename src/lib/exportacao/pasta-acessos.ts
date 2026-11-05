import type { Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/dates";
import { money, sum, toAmountString } from "@/lib/money";
import { contarLinhasDaAba } from "@/lib/xlsx/inspecionar";
import type { Sheet } from "@/lib/xlsx/writer";
import { acharConjunto } from "./conjuntos";
import { rotuloDoFuso } from "./fuso";
import { dataBr, validarParametros, lerDataOpcional, lista, um, type ParamsBrutos } from "./parametros";
import { abaDeDetalhe, abaLeiaMe, paraParede, type EsperadoNaAba } from "./planilha";
import { textoSeguro } from "./texto";
import {
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoNegadaError,
  MAX_LINHAS,
  type ColunaDef,
  type Formato,
  type Papel,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação de CONTAS, ACESSOS e AUDITORIA (ADR-0035) — a parte PURA: pedido, colunas, leitura estreita e montagem
 * das abas. Sem banco (a leitura mora em `acessos.ts`).
 *
 * São cinco abas de dados, todas SOMENTE DE ADMINISTRADOR (e-mails, IPs e navegadores são dados pessoais):
 *  - ESTADO DE AGORA: Contas e Tokens do MCP — sem filtro de data;
 *  - EVENTOS: Acessos (logins), Auditoria do MCP e Exportações — filtrados por "de"/"ate".
 *
 * SEGREDOS NUNCA SAEM, e a defesa é em camadas:
 *  1. a consulta pede só as colunas de `SELECT_*` abaixo — o hash da senha, o hash do token e os argumentos/detalhe do
 *     MCP nem chegam à memória do servidor;
 *  2. os mapeadores (`paraLinha*`) copiam campo a campo, nunca com spread: um campo a mais na linha de origem não passa;
 *  3. as colunas leem só o que declaram em `campos` (um teste prova), então o que não está no catálogo não vira célula.
 * Os argumentos e o `detalhe` da auditoria do MCP guardam linhas inteiras de receita (com CPF/CNPJ) — por isso ficam de fora.
 */

// ---------------------------------------------------------------------------------------------------------------
// O catálogo de abas
// ---------------------------------------------------------------------------------------------------------------

export type AbaAcessos = "contas" | "acessos" | "mcp" | "tokens" | "exportacoes";

export interface AbaDef {
  id: AbaAcessos;
  /** Nome da aba no arquivo (até 31 caracteres, sem [ ] : * ? / \). */
  nome: string;
  /** Rótulo na tela. */
  rotulo: string;
  descricao: string;
  /** Aba de EVENTOS: as datas (de/até) valem para ela. As demais mostram o estado de agora. */
  evento: boolean;
  /** Dados pessoais: só administrador pede (o servidor recusa com 403, não omite em silêncio). */
  somenteAdmin: boolean;
  /** Entra no nome do arquivo CSV (que leva uma aba só). */
  slug: string;
}

export const ABAS_ACESSOS: AbaDef[] = [
  {
    id: "contas",
    nome: "Contas",
    rotulo: "Contas",
    descricao: "Nome, e-mail, papel, situação, criação e último acesso de cada usuário. Estado de agora, sem filtro de data. Nunca a senha.",
    evento: false,
    somenteAdmin: true,
    slug: "contas",
  },
  {
    id: "acessos",
    nome: "Acessos",
    rotulo: "Acessos (logins)",
    descricao: "Cada tentativa de login: quando, e-mail informado, sucesso ou falha, motivo, IP e navegador. Filtrada pelas datas.",
    evento: true,
    somenteAdmin: true,
    slug: "acessos",
  },
  {
    id: "mcp",
    nome: "Auditoria do MCP",
    rotulo: "Auditoria do MCP",
    descricao: "Cada chamada de ferramenta do MCP: quando, quem, ferramenta, se escreve, resultado, erro e duração. Sem os argumentos nem o estado anterior. Filtrada pelas datas.",
    evento: true,
    somenteAdmin: true,
    slug: "auditoria-mcp",
  },
  {
    id: "tokens",
    nome: "Tokens do MCP",
    rotulo: "Tokens do MCP",
    descricao: "Nome, prefixo visível, escopo, dono, criação, último uso e revogação. Estado de agora, sem filtro de data. Nunca o token nem o hash.",
    evento: false,
    somenteAdmin: true,
    slug: "tokens-mcp",
  },
  {
    id: "exportacoes",
    nome: "Exportações",
    rotulo: "Exportações",
    descricao: "O registro de cada download da central: quando, quem, conjunto, formato, linhas, valor, dados pessoais, resultado, erro e filtros. Filtrada pelas datas.",
    evento: true,
    somenteAdmin: true,
    slug: "exportacoes",
  },
];

export const IDS_ABAS_ACESSOS: AbaAcessos[] = ABAS_ACESSOS.map((a) => a.id);

/** Definição de uma aba (o id vem sempre do catálogo, então a busca nunca falha). */
export function defDaAba(id: AbaAcessos): AbaDef {
  const def = ABAS_ACESSOS.find((a) => a.id === id);
  if (!def) throw new Error(`aba desconhecida: ${id}`);
  return def;
}

export function abaAcessosPermitida(id: string, papel: Papel): boolean {
  const def = ABAS_ACESSOS.find((a) => a.id === id);
  return !!def && (!def.somenteAdmin || papel === "ADMIN");
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

export interface PedidoAcessos {
  /** "aaaa-mm-dd" no fuso do app, inclusive; null = sem limite. Vale só para as abas de eventos. */
  de: string | null;
  /** "aaaa-mm-dd" no fuso do app, INCLUSIVE (o dia inteiro entra); null = sem limite. */
  ate: string | null;
  /** Abas escolhidas, sempre na ordem do catálogo. A primeira é a aba principal (a única do CSV). */
  abas: AbaAcessos[];
}

export function lerPedidoAcessos(params: ParamsBrutos): { pedido: PedidoAcessos; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f", "de", "ate"], erros);

  const de = lerDataOpcional(params, "de", "Data inicial", erros);
  const ate = lerDataOpcional(params, "ate", "Data final", erros);
  if (de && ate && de > ate) erros.push("A data inicial é depois da final.");

  const pedidas = lista(params.abas, 20, 40);
  const invalidas = pedidas.filter((a) => !(IDS_ABAS_ACESSOS as string[]).includes(a));
  if (invalidas.length) erros.push(`Aba desconhecida: ${invalidas.map((a) => `"${a.slice(0, 20)}"`).join(", ")}. Use ${IDS_ABAS_ACESSOS.join(", ")}.`);

  // Sempre na ordem do catálogo: quem pede "acessos" antes de "contas" recebe a mesma planilha (e o mesmo CSV).
  let abas: AbaAcessos[] = IDS_ABAS_ACESSOS.filter((id) => pedidas.includes(id));
  if (abas.length === 0 && invalidas.length === 0) {
    // Formulário enviado com todas as caixas desmarcadas é um pedido VAZIO (erro), não "todas" em silêncio;
    // sem formulário (link direto, sem `abas`) o padrão é todas.
    if (enviado) erros.push("Escolha ao menos uma aba para o arquivo.");
    else abas = [...IDS_ABAS_ACESSOS];
  }

  // Data que não muda nada é filtro ignorado em silêncio: Contas e Tokens do MCP não têm data. Melhor avisar.
  if ((de || ate) && abas.length > 0 && !abas.some((id) => defDaAba(id).evento)) {
    erros.push("As datas só valem para as abas de eventos (Acessos, Auditoria do MCP e Exportações). Marque uma delas ou limpe as datas.");
  }
  return { pedido: { de, ate, abas }, erros };
}

/** Quais abas saem no formato: o .xlsx leva todas as escolhidas; o CSV leva só a primeira (a principal). */
export function abasDoFormato(p: PedidoAcessos, formato: Formato): AbaAcessos[] {
  return formato === "csv" ? p.abas.slice(0, 1) : p.abas;
}

/** Quem pode pedir o quê. Repetido no gerador (defesa em profundidade): o despachante e a rota também conferem. */
export function validarPermissoesAcessos(pedido: PedidoAcessos, usuario: UsuarioExport): void {
  if (usuario.papel !== "ADMIN") {
    throw new ExportacaoNegadaError("Contas, acessos e auditoria (e-mails, IPs e navegadores de pessoas) só podem ser exportados por administradores.");
  }
  for (const id of pedido.abas) {
    if (!abaAcessosPermitida(id, usuario.papel)) {
      throw new ExportacaoNegadaError(`A aba "${ABAS_ACESSOS.find((a) => a.id === id)?.nome ?? id}" não está disponível para o seu perfil.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Datas (fuso do app)
// ---------------------------------------------------------------------------------------------------------------

export interface IntervaloEventos {
  /** Primeiro instante incluído (meia-noite de "de" no fuso do app). */
  gte: Date | null;
  /** Primeiro instante EXCLUÍDO (meia-noite do dia seguinte a "ate" no fuso do app). */
  lt: Date | null;
}

/** O dia seguinte a "aaaa-mm-dd", feito no calendário (sem fuso): vira mês, ano e fevereiro bissexto sem conta manual. */
function diaSeguinte(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * "de"/"ate" (datas do calendário no fuso do app) → intervalo de INSTANTES `[gte, lt)`. "ate" é inclusivo: o limite é a
 * meia-noite do dia SEGUINTE, resolvida no fuso — fazer `ate 23:59:59` deixaria de fora o último segundo, e converter
 * "aaaa-mm-dd" como UTC deslizaria o recorte 3 horas (um login às 22h de Natal já é "amanhã" em UTC).
 */
export function intervaloDosEventos(p: Pick<PedidoAcessos, "de" | "ate">): IntervaloEventos {
  return {
    gte: p.de ? fromZonedTime(`${p.de}T00:00:00`, APP_TZ) : null,
    lt: p.ate ? fromZonedTime(`${diaSeguinte(p.ate)}T00:00:00`, APP_TZ) : null,
  };
}

/** O intervalo no formato do filtro de data do Prisma (`undefined` = sem filtro). */
export function filtroDeTempo(iv: IntervaloEventos): { gte?: Date; lt?: Date } | undefined {
  if (!iv.gte && !iv.lt) return undefined;
  return { ...(iv.gte ? { gte: iv.gte } : {}), ...(iv.lt ? { lt: iv.lt } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Do banco para a linha — leitura ESTREITA
// ---------------------------------------------------------------------------------------------------------------

/**
 * As colunas que a consulta pede ao banco, e SÓ elas. `User.passwordHash`, `TokenMcp.hash` e `AuditoriaMcp.argumentos`/
 * `detalhe` não estão aqui de propósito (e um teste trava isso). `satisfies` faz o TypeScript recusar nome de coluna que
 * não existe no modelo.
 */
export const SELECT_CONTA = { name: true, email: true, role: true, isActive: true, createdAt: true, lastLoginAt: true } as const satisfies Prisma.UserSelect;

export const SELECT_ACESSO = { createdAt: true, email: true, success: true, reason: true, ip: true, userAgent: true } as const satisfies Prisma.LoginEventSelect;

export const SELECT_MCP = { quando: true, quem: true, ferramenta: true, escrita: true, resultado: true, erro: true, duracaoMs: true } as const satisfies Prisma.AuditoriaMcpSelect;

export const SELECT_TOKEN = {
  nome: true,
  prefixo: true,
  escopo: true,
  criadoEm: true,
  ultimoUsoEm: true,
  revogadoEm: true,
  user: { select: { name: true, email: true } },
} as const satisfies Prisma.TokenMcpSelect;

export const SELECT_EXPORTACAO = {
  quando: true,
  quem: true,
  papel: true,
  conjunto: true,
  formato: true,
  linhas: true,
  total: true,
  dadosPessoais: true,
  resultado: true,
  erro: true,
  resumoFiltros: true,
} as const satisfies Prisma.ExportacaoLogSelect;

// Os "registros" abaixo são o formato estrutural do que o Prisma devolve com os SELECT_* acima (sem importar o Prisma,
// para os testes montarem a entrada à mão). As datas são INSTANTES; viram relógio de parede em `paraLinha*`.

export interface RegistroConta {
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface RegistroAcesso {
  createdAt: Date;
  email: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface RegistroMcp {
  quando: Date;
  quem: string;
  ferramenta: string;
  escrita: boolean;
  resultado: string;
  erro: string | null;
  duracaoMs: number | null;
}

export interface RegistroToken {
  nome: string;
  prefixo: string;
  escopo: string;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
  revogadoEm: Date | null;
  user: { name: string; email: string };
}

export interface RegistroExportacao {
  quando: Date;
  quem: string;
  papel: string;
  conjunto: string;
  formato: string;
  linhas: number;
  /** Decimal(14,2) do banco (o `Prisma.Decimal` tem `toFixed`); nunca vira `number`. */
  total: { toFixed(casasDecimais: number): string } | null;
  dadosPessoais: boolean;
  resultado: string;
  erro: string | null;
  resumoFiltros: string | null;
}

// As linhas: datas em RELÓGIO DE PAREDE do fuso do app (o Excel não tem fuso).

export interface LinhaConta {
  nome: string;
  email: string;
  papel: string;
  ativa: boolean;
  criadaEm: Date;
  ultimoAcesso: Date | null;
}

export interface LinhaAcesso {
  quando: Date;
  email: string;
  sucesso: boolean;
  motivo: string | null;
  ip: string | null;
  navegador: string | null;
}

export interface LinhaMcp {
  quando: Date;
  quem: string;
  ferramenta: string;
  escrita: boolean;
  resultado: string;
  erro: string | null;
  duracaoMs: number | null;
}

export interface LinhaToken {
  nome: string;
  prefixo: string;
  escopo: string;
  /** "Nome (e-mail)" da pessoa dona do token. */
  dono: string;
  criadoEm: Date;
  ultimoUso: Date | null;
  revogadoEm: Date | null;
}

export interface LinhaExportacao {
  quando: Date;
  quem: string;
  papel: string;
  conjunto: string;
  formato: string;
  linhas: number;
  /** "1234.56" ou null (conjunto sem coluna de valor, ou exportação que falhou/foi recusada). */
  valor: string | null;
  dadosPessoais: boolean;
  resultado: string;
  erro: string | null;
  resumoFiltros: string | null;
}

const parede = (d: Date | null): Date | null => (d ? paraParede(d) : null);

// Campo a campo, SEM spread: o que não está listado aqui não passa, venha o que vier no registro de origem.

export function paraLinhaConta(r: RegistroConta): LinhaConta {
  return { nome: r.name, email: r.email, papel: r.role, ativa: r.isActive, criadaEm: paraParede(r.createdAt), ultimoAcesso: parede(r.lastLoginAt) };
}

export function paraLinhaAcesso(r: RegistroAcesso): LinhaAcesso {
  return { quando: paraParede(r.createdAt), email: r.email, sucesso: r.success, motivo: r.reason, ip: r.ip, navegador: r.userAgent };
}

export function paraLinhaMcp(r: RegistroMcp): LinhaMcp {
  return { quando: paraParede(r.quando), quem: r.quem, ferramenta: r.ferramenta, escrita: r.escrita, resultado: r.resultado, erro: r.erro, duracaoMs: r.duracaoMs };
}

export function paraLinhaToken(r: RegistroToken): LinhaToken {
  return {
    nome: r.nome,
    prefixo: r.prefixo,
    escopo: r.escopo,
    dono: `${r.user.name} (${r.user.email})`,
    criadoEm: paraParede(r.criadoEm),
    ultimoUso: parede(r.ultimoUsoEm),
    revogadoEm: parede(r.revogadoEm),
  };
}

export function paraLinhaExportacao(r: RegistroExportacao): LinhaExportacao {
  return {
    quando: paraParede(r.quando),
    quem: r.quem,
    papel: r.papel,
    conjunto: r.conjunto,
    formato: r.formato,
    linhas: r.linhas,
    valor: r.total === null ? null : r.total.toFixed(2),
    dadosPessoais: r.dadosPessoais,
    resultado: r.resultado,
    erro: r.erro,
    resumoFiltros: r.resumoFiltros,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------------------------------------------

const simNao = (b: boolean): string => (b ? "Sim" : "Não");

/** O resultado de uma exportação com os MESMOS rótulos do histórico da tela (valor desconhecido sai como veio). */
const ROTULO_RESULTADO_EXPORTACAO = new Map<string, string>([
  ["ok", "Entregue"],
  ["recusada", "Recusada"],
  ["erro", "Falhou"],
  ["cancelada", "Cancelada"],
]);
export const rotuloResultadoExportacao = (r: string): string => ROTULO_RESULTADO_EXPORTACAO.get(r) ?? r;
/** O conjunto pelo título da tela ("Inadimplentes", não "inadimplencia"); id desconhecido sai como veio. */
export const rotuloConjunto = (id: string): string => acharConjunto(id)?.titulo ?? id;

// Map, e não objeto: o valor vem do banco e `{}["constructor"]` devolveria uma função em vez de cair no "como veio".
const ROTULO_PAPEL = new Map<string, string>([
  ["ADMIN", "Administrador"],
  ["VIEWER", "Visualizador"],
]);
const ROTULO_ESCOPO = new Map<string, string>([
  ["LEITURA", "Somente leitura"],
  ["ESCRITA", "Leitura e escrita"],
]);

/** O papel como a tela de Contas o mostra; valor desconhecido sai como veio (nunca some). */
export const rotuloPapel = (p: string): string => ROTULO_PAPEL.get(p) ?? p;
export const rotuloEscopo = (e: string): string => ROTULO_ESCOPO.get(e) ?? e;

export const COLUNAS_CONTAS: ColunaDef<LinhaConta>[] = [
  { id: "nome", titulo: "Nome", grupo: "contas", tipo: "texto", largura: 30, valor: (l) => l.nome, campos: ["nome"] },
  { id: "email", titulo: "E-mail", grupo: "contas", tipo: "texto", largura: 34, valor: (l) => l.email, campos: ["email"] },
  { id: "papel", titulo: "Papel", grupo: "contas", tipo: "texto", largura: 15, valor: (l) => rotuloPapel(l.papel), campos: ["papel"] },
  { id: "ativa", titulo: "Ativa", grupo: "contas", tipo: "texto", largura: 8, valor: (l) => simNao(l.ativa), campos: ["ativa"] },
  { id: "criadaEm", titulo: "Criada em", grupo: "contas", tipo: "datahora", largura: 17, valor: (l) => l.criadaEm, campos: ["criadaEm"] },
  { id: "ultimoAcesso", titulo: "Último acesso", grupo: "contas", tipo: "datahora", largura: 17, valor: (l) => l.ultimoAcesso, campos: ["ultimoAcesso"] },
];

export const COLUNAS_ACESSOS: ColunaDef<LinhaAcesso>[] = [
  { id: "quando", titulo: "Quando", grupo: "acessos", tipo: "datahora", largura: 17, valor: (l) => l.quando, campos: ["quando"] },
  { id: "email", titulo: "E-mail informado", grupo: "acessos", tipo: "texto", largura: 34, valor: (l) => l.email, campos: ["email"] },
  { id: "sucesso", titulo: "Sucesso", grupo: "acessos", tipo: "texto", largura: 9, valor: (l) => simNao(l.sucesso), campos: ["sucesso"] },
  { id: "motivo", titulo: "Motivo", grupo: "acessos", tipo: "texto", largura: 22, valor: (l) => l.motivo, campos: ["motivo"] },
  { id: "ip", titulo: "IP", grupo: "acessos", tipo: "texto", largura: 18, valor: (l) => l.ip, campos: ["ip"] },
  { id: "navegador", titulo: "Navegador (user agent)", grupo: "acessos", tipo: "texto", largura: 70, valor: (l) => l.navegador, campos: ["navegador"] },
];

export const COLUNAS_MCP: ColunaDef<LinhaMcp>[] = [
  { id: "quando", titulo: "Quando", grupo: "mcp", tipo: "datahora", largura: 17, valor: (l) => l.quando, campos: ["quando"] },
  { id: "quem", titulo: "Quem", grupo: "mcp", tipo: "texto", largura: 52, valor: (l) => l.quem, campos: ["quem"] },
  { id: "ferramenta", titulo: "Ferramenta", grupo: "mcp", tipo: "texto", largura: 28, valor: (l) => l.ferramenta, campos: ["ferramenta"] },
  { id: "escrita", titulo: "Escrita", grupo: "mcp", tipo: "texto", largura: 9, valor: (l) => simNao(l.escrita), campos: ["escrita"] },
  { id: "resultado", titulo: "Resultado", grupo: "mcp", tipo: "texto", largura: 12, valor: (l) => l.resultado, campos: ["resultado"] },
  { id: "erro", titulo: "Erro", grupo: "mcp", tipo: "texto", largura: 60, valor: (l) => l.erro, campos: ["erro"] },
  { id: "duracaoMs", titulo: "Duração (ms)", grupo: "mcp", tipo: "inteiro", largura: 13, valor: (l) => l.duracaoMs, campos: ["duracaoMs"] },
];

export const COLUNAS_TOKENS: ColunaDef<LinhaToken>[] = [
  { id: "nome", titulo: "Nome do token", grupo: "tokens", tipo: "texto", largura: 30, valor: (l) => l.nome, campos: ["nome"] },
  { id: "prefixo", titulo: "Prefixo visível", grupo: "tokens", tipo: "texto", largura: 16, valor: (l) => l.prefixo, campos: ["prefixo"] },
  { id: "escopo", titulo: "Escopo", grupo: "tokens", tipo: "texto", largura: 18, valor: (l) => rotuloEscopo(l.escopo), campos: ["escopo"] },
  { id: "dono", titulo: "Usuário dono", grupo: "tokens", tipo: "texto", largura: 46, valor: (l) => l.dono, campos: ["dono"] },
  { id: "criadoEm", titulo: "Criado em", grupo: "tokens", tipo: "datahora", largura: 17, valor: (l) => l.criadoEm, campos: ["criadoEm"] },
  { id: "ultimoUso", titulo: "Último uso", grupo: "tokens", tipo: "datahora", largura: 17, valor: (l) => l.ultimoUso, campos: ["ultimoUso"] },
  { id: "revogadoEm", titulo: "Revogado em", grupo: "tokens", tipo: "datahora", largura: 17, valor: (l) => l.revogadoEm, campos: ["revogadoEm"] },
];

export const COLUNAS_EXPORTACOES: ColunaDef<LinhaExportacao>[] = [
  { id: "quando", titulo: "Quando", grupo: "exportacoes", tipo: "datahora", largura: 17, valor: (l) => l.quando, campos: ["quando"] },
  { id: "quem", titulo: "Quem", grupo: "exportacoes", tipo: "texto", largura: 46, valor: (l) => l.quem, campos: ["quem"] },
  { id: "papel", titulo: "Papel", grupo: "exportacoes", tipo: "texto", largura: 15, valor: (l) => rotuloPapel(l.papel), campos: ["papel"] },
  { id: "conjunto", titulo: "Conjunto", grupo: "exportacoes", tipo: "texto", largura: 16, valor: (l) => rotuloConjunto(l.conjunto), campos: ["conjunto"] },
  { id: "formato", titulo: "Formato", grupo: "exportacoes", tipo: "texto", largura: 9, valor: (l) => l.formato, campos: ["formato"] },
  { id: "linhas", titulo: "Linhas", grupo: "exportacoes", tipo: "inteiro", largura: 10, valor: (l) => l.linhas, campos: ["linhas"] },
  { id: "valor", titulo: "Valor total do arquivo", grupo: "exportacoes", tipo: "dinheiro", largura: 22, valor: (l) => l.valor, campos: ["valor"] },
  { id: "dadosPessoais", titulo: "Dados pessoais", grupo: "exportacoes", tipo: "texto", largura: 15, valor: (l) => simNao(l.dadosPessoais), campos: ["dadosPessoais"] },
  { id: "resultado", titulo: "Resultado", grupo: "exportacoes", tipo: "texto", largura: 12, valor: (l) => rotuloResultadoExportacao(l.resultado), campos: ["resultado"] },
  { id: "erro", titulo: "Erro", grupo: "exportacoes", tipo: "texto", largura: 50, valor: (l) => l.erro, campos: ["erro"] },
  { id: "resumoFiltros", titulo: "Filtros (resumo)", grupo: "exportacoes", tipo: "texto", largura: 80, valor: (l) => l.resumoFiltros, campos: ["resumoFiltros"] },
];

export function titulosDaAba(id: AbaAcessos): string[] {
  switch (id) {
    case "contas":
      return COLUNAS_CONTAS.map((c) => c.titulo);
    case "acessos":
      return COLUNAS_ACESSOS.map((c) => c.titulo);
    case "mcp":
      return COLUNAS_MCP.map((c) => c.titulo);
    case "tokens":
      return COLUNAS_TOKENS.map((c) => c.titulo);
    case "exportacoes":
      return COLUNAS_EXPORTACOES.map((c) => c.titulo);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Descrição do pedido, nome do arquivo e teto
// ---------------------------------------------------------------------------------------------------------------

export function descreverPedidoAcessos(p: PedidoAcessos, formato: Formato = "xlsx"): Array<[string, string]> {
  const temEvento = p.abas.some((id) => defDaAba(id).evento);
  let periodo: string;
  if (!temEvento) periodo = "não se aplica (nenhuma aba de eventos marcada)";
  else if (p.de && p.ate) periodo = `${dataBr(p.de)} a ${dataBr(p.ate)}`;
  else if (p.de) periodo = `a partir de ${dataBr(p.de)}`;
  else if (p.ate) periodo = `até ${dataBr(p.ate)}`;
  else periodo = "todo o histórico (sem filtro de datas)";

  const out: Array<[string, string]> = [
    [`Período dos eventos (${rotuloDoFuso()})`, periodo],
    ["Abas pedidas", p.abas.map((id) => defDaAba(id).nome).join(" · ")],
  ];
  const principal = abasDoFormato(p, formato)[0];
  if (formato === "csv" && principal) {
    // O CSV leva uma aba só: dizer qual (e que as outras ficaram de fora) é o que impede a omissão silenciosa.
    const so = defDaAba(principal).nome;
    out.push(["Formato", p.abas.length > 1 ? `CSV: sai só a aba ${so} (a primeira marcada); as outras não saem neste formato` : `CSV: aba ${so}`]);
  }
  return out;
}

/** Os filtros normalizados, para reproduzir o recorte depois (vão para o log). Só texto e listas: seguro como JSON. */
export function filtrosJsonAcessos(p: PedidoAcessos, formato: Formato): Record<string, unknown> {
  return { de: p.de, ate: p.ate, abas: p.abas, formato, abasNoArquivo: abasDoFormato(p, formato), fuso: APP_TZ };
}

export function nomeDoArquivoAcessos(p: PedidoAcessos, hojeIso: string, extensao = "xlsx"): string {
  const entregues = extensao === "csv" ? p.abas.slice(0, 1) : p.abas;
  // "_filtrado" só quando a data de fato mexeu em alguma aba que está no arquivo.
  const filtrado = (p.de || p.ate) && entregues.some((id) => defDaAba(id).evento) ? "_filtrado" : "";
  if (extensao === "csv") {
    const a = entregues[0];
    return `Contas_e_acessos_${a ? defDaAba(a).slug : "vazio"}_${hojeIso}${filtrado}.csv`;
  }
  return `Contas_e_acessos_${hojeIso}${filtrado}.${extensao}`;
}

/**
 * Recorte acima do teto de linhas POR ABA: recusa com a mensagem do que fazer. `contagens` são as do banco (lidas antes
 * de carregar qualquer linha, para estourar cedo e barato).
 */
export function verificarTeto(contagens: Partial<Record<AbaAcessos, number>>, max: number = MAX_LINHAS): void {
  const estouros = ABAS_ACESSOS.filter((a) => (contagens[a.id] ?? 0) > max);
  if (estouros.length === 0) return;
  const partes = estouros.map((a) => `${a.nome} (${(contagens[a.id] ?? 0).toLocaleString("pt-BR")} linhas${a.evento ? "" : ", esta aba não é filtrada por data"})`);
  const eventos = estouros.some((a) => a.evento);
  const estado = estouros.some((a) => !a.evento);
  // Data só ajuda as abas de eventos; as de estado (Contas, Tokens) só saem do caminho se forem desmarcadas.
  const fazer =
    eventos && estado
      ? "Informe datas (de/até) para reduzir o período das abas de eventos e desmarque as abas de estado que passaram do máximo."
      : eventos
        ? "Informe datas (de/até) para reduzir o período."
        : "Desmarque as abas que passaram do máximo.";
  throw new ExportacaoGrandeDemaisError(`O recorte passa do máximo de ${max.toLocaleString("pt-BR")} linhas por aba: ${partes.join("; ")}. ${fazer}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência contra o banco
// ---------------------------------------------------------------------------------------------------------------

/** Linhas já mapeadas, por aba. Uma aba ausente (`undefined`) é uma aba não pedida. */
export interface DadosAcessos {
  contas?: LinhaConta[];
  acessos?: LinhaAcesso[];
  mcp?: LinhaMcp[];
  tokens?: LinhaToken[];
  exportacoes?: LinhaExportacao[];
}

/**
 * O que o BANCO diz sobre cada aba pedida, lido na MESMA transação das linhas: a contagem e, para cada campo que vira
 * rótulo (Sim/Não, papel, escopo), uma contagem independente — pega um rótulo invertido, que a contagem total não pega.
 */
export interface ReferenciaBancoAcessos {
  contas?: { contagem: number; ativas: number; administradores: number };
  acessos?: { contagem: number; sucessos: number };
  mcp?: { contagem: number; escritas: number };
  tokens?: { contagem: number; revogados: number; comEscrita: number };
  /** `valor`: soma do `total` no banco ("1234.56"). */
  exportacoes?: { contagem: number; valor: string; comDadosPessoais: number };
}

/** A lista do que NÃO fechou (vazia = ok). Quem chama transforma qualquer divergência em `ExportacaoInconsistenteError`. */
export function conferirContraBancoAcessos(dados: DadosAcessos, ref: ReferenciaBancoAcessos): string[] {
  const problemas: string[] = [];
  const igual = (aba: string, o: string, lido: number, banco: number) => {
    if (lido !== banco) problemas.push(`${aba}, ${o}: lido ${lido} ≠ banco ${banco}`);
  };

  // O inverso também: aba entregue sem referência é aba que ninguém conferiu.
  for (const a of ABAS_ACESSOS) {
    if (dados[a.id] !== undefined && ref[a.id] === undefined) problemas.push(`${a.nome}: lida sem referência do banco para conferir`);
    if (dados[a.id] === undefined && ref[a.id] !== undefined) problemas.push(`${a.nome}: o banco tem referência, mas a aba não foi lida`);
  }

  if (dados.contas && ref.contas) {
    igual("Contas", "linhas", dados.contas.length, ref.contas.contagem);
    igual("Contas", "ativas", dados.contas.filter((l) => l.ativa).length, ref.contas.ativas);
    igual("Contas", "administradores", dados.contas.filter((l) => l.papel === "ADMIN").length, ref.contas.administradores);
  }
  if (dados.acessos && ref.acessos) {
    igual("Acessos", "linhas", dados.acessos.length, ref.acessos.contagem);
    igual("Acessos", "logins com sucesso", dados.acessos.filter((l) => l.sucesso).length, ref.acessos.sucessos);
  }
  if (dados.mcp && ref.mcp) {
    igual("Auditoria do MCP", "linhas", dados.mcp.length, ref.mcp.contagem);
    igual("Auditoria do MCP", "escritas", dados.mcp.filter((l) => l.escrita).length, ref.mcp.escritas);
  }
  if (dados.tokens && ref.tokens) {
    igual("Tokens do MCP", "linhas", dados.tokens.length, ref.tokens.contagem);
    igual("Tokens do MCP", "revogados", dados.tokens.filter((l) => l.revogadoEm !== null).length, ref.tokens.revogados);
    igual("Tokens do MCP", "com escrita", dados.tokens.filter((l) => l.escopo === "ESCRITA").length, ref.tokens.comEscrita);
  }
  if (dados.exportacoes && ref.exportacoes) {
    igual("Exportações", "linhas", dados.exportacoes.length, ref.exportacoes.contagem);
    igual("Exportações", "com dados pessoais", dados.exportacoes.filter((l) => l.dadosPessoais).length, ref.exportacoes.comDadosPessoais);
    // Dinheiro em decimal exato: a soma das linhas lidas tem de ser a que o banco soma (um centavo a menos já acusa).
    const local = toAmountString(sum(dados.exportacoes.map((l) => l.valor ?? "0")));
    const banco = toAmountString(money(ref.exportacoes.valor));
    if (local !== banco) problemas.push(`Exportações: soma de "Valor total do arquivo" lida (${local}) ≠ soma do banco (${banco})`);
  }
  return problemas;
}

/**
 * Conferência EXTRA da leitura de volta do .xlsx: o número de linhas de cada aba tem de ser EXATO. A leitura de volta de
 * `empacotar` (abas sem coluna de soma) acusa linha a MENOS, mas não linha a mais; como estas abas não têm rodapé nem
 * nota, cabeçalho + dados é tudo que a aba tem.
 */
export function conferirContagemExataDoArquivo(arquivo: Buffer, esperado: EsperadoNaAba[]): string[] {
  const problemas: string[] = [];
  for (const e of esperado) {
    try {
      const linhas = contarLinhasDaAba(arquivo, e.nomeAba);
      if (linhas !== e.nLinhas + 1) problemas.push(`${e.nomeAba}: o arquivo tem ${Math.max(0, linhas - 1)} linha(s) de dados, esperado ${e.nLinhas}`);
    } catch (err) {
      problemas.push(`${e.nomeAba}: não consegui reler a aba (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------
// Montagem das abas
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaPastaAcessos {
  dados: DadosAcessos;
  pedido: PedidoAcessos;
  formato: Formato;
  geradoEm: Date;
  usuario: UsuarioExport;
}

export interface SaidaPastaAcessos {
  /** Leia-me + as abas de dados do formato, na ordem do catálogo. */
  abas: Sheet[];
  /** Um por aba de dados (as não escolhidas não existem no arquivo). */
  esperado: EsperadoNaAba[];
  /** Nome da aba principal (a primeira escolhida): a única que o CSV leva. */
  principal: string;
  linhasPorAba: Array<{ id: AbaAcessos; nome: string; linhas: number }>;
  /** Linhas de dados de TODAS as abas entregues. */
  nLinhas: number;
}

const n = (x: number): string => x.toLocaleString("pt-BR");

/** Os avisos do Leia-me que valem para ESTE arquivo (só falam das abas que estão nele). */
function avisosDoLeiaMe(ids: AbaAcessos[]): string[] {
  const tem = (id: AbaAcessos) => ids.includes(id);
  const avisos = [
    "DADOS PESSOAIS: esta planilha contém e-mails, endereços IP e navegadores (user agent) de pessoas. É de uso restrito a administradores: trate com o cuidado devido (LGPD) e não a encaminhe a quem não precisa.",
    "O que NÃO sai, de propósito: senhas (nem o hash delas), os tokens do MCP (só o prefixo visível; nunca o token nem o hash) e, na auditoria do MCP, os argumentos e o estado anterior de cada chamada, que podem conter linhas inteiras de receita com CPF/CNPJ.",
  ];
  if (ids.some((id) => defDaAba(id).evento)) {
    avisos.push(`As datas (de/até) valem só para as abas de eventos (Acessos, Auditoria do MCP e Exportações), no ${rotuloDoFuso()} e com a data final inclusa.`);
  }
  if (tem("contas") || tem("tokens")) {
    avisos.push(`${[tem("contas") ? "Contas" : "", tem("tokens") ? "Tokens do MCP" : ""].filter(Boolean).join(" e ")}: estado de agora, sem filtro de data.`);
  }
  if (tem("contas")) avisos.push("Contas: 'Último acesso' é o do último login com sucesso; em branco = nunca entrou.");
  if (tem("acessos")) {
    avisos.push(
      "Acessos: uma linha por tentativa de login, com sucesso ou não. 'E-mail informado' é o que foi digitado, exista ou não uma conta com ele. O IP vem do cabeçalho x-forwarded-for e pode não ser o endereço real de quem acessou.",
    );
  }
  if (tem("mcp")) {
    avisos.push("Auditoria do MCP: uma linha por chamada de ferramenta. 'Quem' é 'e-mail via MCP (nome do token)'. 'Erro' é texto livre da ferramenta e pode citar valores informados na chamada.");
  }
  if (tem("tokens")) avisos.push("Tokens do MCP: revogar não apaga. O token continua listado, com a data da revogação.");
  if (tem("exportacoes")) {
    avisos.push(
      "Exportações: o registro de cada download. Esta exportação ainda não aparece nele (é registrada depois de entregue). 'Valor total do arquivo' é a soma da coluna de valor do arquivo exportado, quando o conjunto tem uma: não some essa coluna.",
    );
  }
  avisos.push(`Horários no ${rotuloDoFuso()}. A planilha mostra a hora até o minuto, mas a célula guarda também os segundos.`);
  return avisos;
}

export function montarAbasAcessos(e: EntradaPastaAcessos): SaidaPastaAcessos {
  const ids = abasDoFormato(e.pedido, e.formato);
  if (ids.length === 0) throw new ExportacaoInconsistenteError("Nenhuma aba foi escolhida: não há o que montar.");

  const abasDeDados: Sheet[] = [];
  const esperado: EsperadoNaAba[] = [];
  const linhasPorAba: SaidaPastaAcessos["linhasPorAba"] = [];

  const adicionar = <L>(id: AbaAcessos, colunas: ColunaDef<L>[], linhas: L[] | undefined): void => {
    const def = defDaAba(id);
    // Aba pedida e não lida é defeito, nunca "aba vazia": entregaria um arquivo que parece dizer "zero eventos".
    if (linhas === undefined) throw new ExportacaoInconsistenteError(`A aba "${def.nome}" foi pedida, mas não foi lida do banco.`);
    abasDeDados.push(abaDeDetalhe({ nome: def.nome, colunas, linhas }).aba);
    esperado.push({ nomeAba: def.nome, titulos: colunas.map((c) => c.titulo), nLinhas: linhas.length, indiceValor: -1, total: null });
    linhasPorAba.push({ id, nome: def.nome, linhas: linhas.length });
  };

  for (const id of ids) {
    switch (id) {
      case "contas":
        adicionar(id, COLUNAS_CONTAS, e.dados.contas);
        break;
      case "acessos":
        adicionar(id, COLUNAS_ACESSOS, e.dados.acessos);
        break;
      case "mcp":
        adicionar(id, COLUNAS_MCP, e.dados.mcp);
        break;
      case "tokens":
        adicionar(id, COLUNAS_TOKENS, e.dados.tokens);
        break;
      case "exportacoes":
        adicionar(id, COLUNAS_EXPORTACOES, e.dados.exportacoes);
        break;
    }
  }

  const nLinhas = linhasPorAba.reduce((a, l) => a + l.linhas, 0);
  const resultado: Array<[string, string]> = [];
  if (e.dados.contas && ids.includes("contas")) {
    resultado.push(["Contas", `${n(e.dados.contas.length)} (${n(e.dados.contas.filter((l) => l.ativa).length)} ativa(s))`]);
  }
  if (e.dados.acessos && ids.includes("acessos")) {
    resultado.push(["Acessos", `${n(e.dados.acessos.length)} (${n(e.dados.acessos.filter((l) => !l.sucesso).length)} falha(s) de login)`]);
  }
  if (e.dados.mcp && ids.includes("mcp")) {
    resultado.push(["Auditoria do MCP", `${n(e.dados.mcp.length)} (${n(e.dados.mcp.filter((l) => l.escrita).length)} chamada(s) de escrita)`]);
  }
  if (e.dados.tokens && ids.includes("tokens")) {
    resultado.push(["Tokens do MCP", `${n(e.dados.tokens.length)} (${n(e.dados.tokens.filter((l) => l.revogadoEm !== null).length)} revogado(s))`]);
  }
  if (e.dados.exportacoes && ids.includes("exportacoes")) {
    resultado.push(["Exportações", `${n(e.dados.exportacoes.length)} (${n(e.dados.exportacoes.filter((l) => l.dadosPessoais).length)} com dados pessoais)`]);
  }
  resultado.push(["Linhas de dados no arquivo", n(nLinhas)]);

  const leiaMe = abaLeiaMe({
    titulo: "Exportação de contas, acessos e auditoria — Seahub Financeiro",
    geradoEm: e.geradoEm,
    // O nome da conta é texto livre do banco: um caractere de controle nele faria o Excel abrir o arquivo em modo de reparo.
    geradoPor: textoSeguro(`${e.usuario.nome} (${e.usuario.email})`),
    filtros: descreverPedidoAcessos(e.pedido, e.formato),
    resultado,
    frescor: { texto: "Lido do banco no momento da exportação. São registros gravados na hora em que o fato acontece: não dependem da sincronização com o Conexa.", alerta: false },
    avisos: avisosDoLeiaMe(ids),
    conferencia: `OK. A contagem de linhas de cada aba${ids.includes("exportacoes") ? " (e, em Exportações, a soma de 'Valor total do arquivo')" : ""} foi conferida contra o banco, lida na mesma transação, e contra o arquivo lido de volta, antes de entregar.`,
  });

  return { abas: [...abasDeDados, leiaMe], esperado, principal: defDaAba(ids[0]!).nome, linhasPorAba, nLinhas };
}
