import type { Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/dates";
import { money, sum, toAmountString } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { dataBr, validarParametros, lerDataOpcional, lerSimNao, lista, um, type ParamsBrutos } from "./parametros";
import { rotuloDoFuso } from "./fuso";
import { abaDeDetalhe, abaDeTabela, abaLeiaMe, paraParede, type ColunaTabela, type Detalhe } from "./planilha";
import {
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoNegadaError,
  MAX_LINHAS,
  type ColunaDef,
  type GrupoDef,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação do HISTÓRICO DE SINCRONIZAÇÕES de receita (ADR-0035) — a parte PURA: pedido, colunas, conferências e
 * montagem das abas. Sem banco (a leitura mora em `sincronizacoes.ts`, que é `server-only` e portanto não testável).
 *
 * Cada linha é UMA rodada (`revenue_sync_runs`). ⚠ O "Total recebido" de uma rodada é o que ELA calculou na hora (um
 * retrato do momento) e a sincronização automática recalcula o MESMO período a cada tick: somar o dinheiro entre
 * rodadas contaria o mesmo mês dezenas de vezes. Por isso esta planilha NÃO tem linha de total nem subtotal de dinheiro
 * (só contagens somam: cada rodada é uma só). A conferência é por contagem e por soma INTERNA contra o banco, e o
 * arquivo é relido (cabeçalho e número de linhas) por `entregar()`.
 */

/** O conjunto inteiro é restrito a administradores? (O gerador repete esta checagem: defesa em profundidade.) */
export const SINCRONIZACOES_SOMENTE_ADMIN = false;

export const NOME_ABA_PRINCIPAL_SINC = "Rodadas";

// ---------------------------------------------------------------------------------------------------------------
// Domínio: origem e status
// ---------------------------------------------------------------------------------------------------------------

export const ORIGENS_SINC = ["AUTOMATICO", "MANUAL", "IMPORTACAO"] as const;
export type OrigemSinc = (typeof ORIGENS_SINC)[number];

export const STATUS_SINC = ["DONE", "FAILED", "RUNNING"] as const;
export type StatusSinc = (typeof STATUS_SINC)[number];

/** Os MESMOS rótulos do selo de origem da tela (components/selo.tsx). Um teste confere que continuam iguais. */
export const ROTULO_ORIGEM_SINC: Record<OrigemSinc, string> = {
  AUTOMATICO: "Automática",
  MANUAL: "Manual",
  IMPORTACAO: "Importação",
};

/** Os MESMOS rótulos da tela /runs. Um teste confere que continuam iguais. */
export const ROTULO_STATUS_SINC: Record<StatusSinc, string> = {
  DONE: "Concluída",
  FAILED: "Falhou",
  RUNNING: "Sincronizando",
};

/** Valor fora da tabela aparece COMO VEIO (nunca some); `hasOwn` porque "constructor" não pode virar função. */
const rotulo = (tabela: Record<string, string>, chave: string): string => (Object.hasOwn(tabela, chave) ? tabela[chave]! : chave);
export const rotuloOrigemSinc = (o: string): string => rotulo(ROTULO_ORIGEM_SINC, o);
export const rotuloStatusSinc = (s: string): string => rotulo(ROTULO_STATUS_SINC, s);

/** Posição para ordenar (conhecidos na ordem do catálogo, desconhecidos depois, por nome). */
const posicao = (catalogo: readonly string[], v: string): number => {
  const i = catalogo.indexOf(v);
  return i < 0 ? catalogo.length : i;
};

// ---------------------------------------------------------------------------------------------------------------
// Linha e colunas
// ---------------------------------------------------------------------------------------------------------------

export interface LinhaRodada {
  id: string;
  /** Relógio de parede (fuso do app). */
  iniciadoEm: Date;
  /** Relógio de parede (fuso do app); null enquanto a rodada não concluiu. */
  concluidoEm: Date | null;
  /**
   * Segundos entre o início e a conclusão, calculados dos INSTANTES (o relógio de parede erraria uma hora na virada de
   * horário de verão). null sem conclusão. Negativo quando a conclusão é anterior ao início — mostrado como veio.
   */
  duracaoSegundos: number | null;
  /** Data pura (meia-noite UTC). */
  periodoInicio: Date;
  periodoFim: Date;
  /** Valor do banco; o rótulo em português sai na coluna. */
  origem: string;
  status: string;
  faturasCR: number;
  itensLV: number;
  semLV: number;
  linhasNovas: number;
  linhasAtualizadas: number;
  orfasPreservadas: number;
  faturasComConflito: number;
  /** "1234.56" — o que ESTA rodada calculou na hora. */
  totalRecebido: string;
  diferencaConferencia: string;
  /** A rodada tem texto de erro gravado? Sempre lido (as contagens precisam); o TEXTO só sai no grupo "tecnico". */
  temErro: boolean;
  erro: string | null;
  /** Texto pronto (nome + início do SHA-256 de cada arquivo); só com o grupo "tecnico". */
  arquivosImportados: string | null;
}

export const GRUPOS_SINC: GrupoDef[] = [
  {
    id: "essenciais",
    rotulo: "Essenciais",
    descricao: "Início, conclusão, duração, período, origem, status, contagens de linhas, totais e diferença de conferência.",
    somenteAdmin: false,
    padrao: true,
    fixo: true,
  },
  {
    id: "tecnico",
    rotulo: "Detalhe técnico",
    descricao: "Texto do erro e arquivos importados (nome e início do SHA-256). Texto livre do sistema: somente administrador.",
    somenteAdmin: true,
    padrao: false,
  },
];

export const COLUNAS_SINC: ColunaDef<LinhaRodada>[] = [
  { id: "inicio", titulo: "Início", grupo: "essenciais", tipo: "datahora", largura: 17, valor: (l) => l.iniciadoEm, campos: ["iniciadoEm"] },
  { id: "conclusao", titulo: "Conclusão", grupo: "essenciais", tipo: "datahora", largura: 17, valor: (l) => l.concluidoEm, campos: ["concluidoEm"] },
  { id: "duracao", titulo: "Duração (s)", grupo: "essenciais", tipo: "inteiro", largura: 12, valor: (l) => l.duracaoSegundos, campos: ["duracaoSegundos"] },
  { id: "periodoDe", titulo: "Período de", grupo: "essenciais", tipo: "data", largura: 12, valor: (l) => l.periodoInicio, campos: ["periodoInicio"] },
  { id: "periodoAte", titulo: "Período até", grupo: "essenciais", tipo: "data", largura: 12, valor: (l) => l.periodoFim, campos: ["periodoFim"] },
  { id: "origem", titulo: "Origem", grupo: "essenciais", tipo: "texto", largura: 13, valor: (l) => rotuloOrigemSinc(l.origem), campos: ["origem"] },
  { id: "status", titulo: "Status", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => rotuloStatusSinc(l.status), campos: ["status"] },
  { id: "faturasCR", titulo: "Faturas CR", grupo: "essenciais", tipo: "inteiro", largura: 11, valor: (l) => l.faturasCR, campos: ["faturasCR"] },
  { id: "itensLV", titulo: "Itens LV", grupo: "essenciais", tipo: "inteiro", largura: 10, valor: (l) => l.itensLV, campos: ["itensLV"] },
  { id: "semLV", titulo: "Sem LV", grupo: "essenciais", tipo: "inteiro", largura: 9, valor: (l) => l.semLV, campos: ["semLV"] },
  { id: "novas", titulo: "Linhas novas", grupo: "essenciais", tipo: "inteiro", largura: 12, valor: (l) => l.linhasNovas, campos: ["linhasNovas"] },
  { id: "atualizadas", titulo: "Atualizadas", grupo: "essenciais", tipo: "inteiro", largura: 12, valor: (l) => l.linhasAtualizadas, campos: ["linhasAtualizadas"] },
  { id: "orfas", titulo: "Órfãs preservadas", grupo: "essenciais", tipo: "inteiro", largura: 17, valor: (l) => l.orfasPreservadas, campos: ["orfasPreservadas"] },
  { id: "conflitos", titulo: "Faturas com conflito", grupo: "essenciais", tipo: "inteiro", largura: 20, valor: (l) => l.faturasComConflito, campos: ["faturasComConflito"] },
  { id: "totalRecebido", titulo: "Total recebido", grupo: "essenciais", tipo: "dinheiro", largura: 16, valor: (l) => l.totalRecebido, campos: ["totalRecebido"] },
  { id: "diferenca", titulo: "Diferença de conferência", grupo: "essenciais", tipo: "dinheiro", largura: 24, valor: (l) => l.diferencaConferencia, campos: ["diferencaConferencia"] },
  { id: "idRodada", titulo: "ID da rodada", grupo: "essenciais", tipo: "texto", largura: 28, valor: (l) => l.id, campos: ["id"] },
  { id: "erro", titulo: "Erro", grupo: "tecnico", tipo: "texto", largura: 80, valor: (l) => l.erro, campos: ["erro"] },
  { id: "arquivos", titulo: "Arquivos importados", grupo: "tecnico", tipo: "texto", largura: 90, valor: (l) => l.arquivosImportados, campos: ["arquivosImportados"] },
];

export const GRUPOS_OPCIONAIS_SINC = GRUPOS_SINC.filter((g) => !g.fixo).map((g) => g.id);

export function colunasSinc(grupos: readonly string[]): ColunaDef<LinhaRodada>[] {
  const ativos = new Set<string>(["essenciais", ...grupos]);
  return COLUNAS_SINC.filter((c) => ativos.has(c.grupo));
}

export function grupoSincPermitido(g: string, papel: UsuarioExport["papel"]): boolean {
  const def = GRUPOS_SINC.find((x) => x.id === g);
  return !!def && (!def.somenteAdmin || papel === "ADMIN");
}

/**
 * Permissão ANTES de ler qualquer dado: o conjunto (se um dia for só de administrador) e cada grupo de colunas.
 * Recusa com `ExportacaoNegadaError` (403) — nunca omite a coluna em silêncio.
 */
export function validarPermissoesSincronizacoes(pedido: Pick<PedidoSincronizacoes, "grupos">, usuario: UsuarioExport): void {
  if (SINCRONIZACOES_SOMENTE_ADMIN && usuario.papel !== "ADMIN") {
    throw new ExportacaoNegadaError("O conjunto Sincronizações só pode ser exportado por administradores.");
  }
  for (const g of pedido.grupos) {
    if (!grupoSincPermitido(g, usuario.papel)) {
      throw new ExportacaoNegadaError(
        g === "tecnico"
          ? "O detalhe técnico (texto do erro e arquivos importados) só pode ser exportado por administradores."
          : `O grupo de colunas "${g}" não está disponível para o seu perfil.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido (da URL)
// ---------------------------------------------------------------------------------------------------------------

export interface PedidoSincronizacoes {
  /** "aaaa-mm-dd" — INÍCIO da rodada, no fuso do app, inclusive. null = sem limite. */
  de: string | null;
  /** "aaaa-mm-dd" — INCLUSIVE o dia inteiro. null = sem limite. */
  ate: string | null;
  /** Vazio = todas. */
  origens: OrigemSinc[];
  /** Vazio = todos. */
  status: StatusSinc[];
  /** Grupos de colunas além do fixo "essenciais". */
  grupos: string[];
  /** Incluir as abas "Por origem e status" e "Por dia". */
  resumos: boolean;
}

/**
 * Lê e VALIDA os parâmetros. Valor malformado vira ERRO (nunca filtro ignorado: uma data digitada errada entregaria o
 * histórico inteiro como se fosse o recorte pedido).
 *
 * A API NÃO assume período padrão: sem datas cobre tudo (e pode passar do teto de linhas). Quem pré-preenche os últimos
 * 30 dias é a TELA (`periodoPadraoDaTela`). `f=1` marca o envio do formulário: sem ele, a ausência de `resumos` vale
 * "ligado"; com ele, a caixa ausente vale "desmarcada". Grupos de colunas pedidos explicitamente valem sempre.
 */
export function lerPedidoSincronizacoes(params: ParamsBrutos): { pedido: PedidoSincronizacoes; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";

  // Parâmetro de valor ÚNICO enviado duas vezes com valores diferentes (`de=…&de=…`) é erro (ver `validarParametros`).
  validarParametros(params, ["f", "de", "ate", "resumos"], erros);

  const de = lerDataOpcional(params, "de", "Data inicial", erros);
  const ate = lerDataOpcional(params, "ate", "Data final", erros);
  if (de && ate && de > ate) erros.push("A data inicial é depois da data final.");

  const origens: OrigemSinc[] = [];
  for (const o of lista(params.origem, 10, 30)) {
    if ((ORIGENS_SINC as readonly string[]).includes(o)) origens.push(o as OrigemSinc);
    else erros.push(`Origem desconhecida ("${o.slice(0, 20)}"): use ${ORIGENS_SINC.join(", ")}.`);
  }

  const status: StatusSinc[] = [];
  for (const s of lista(params.status, 10, 30)) {
    if ((STATUS_SINC as readonly string[]).includes(s)) status.push(s as StatusSinc);
    else erros.push(`Status desconhecido ("${s.slice(0, 20)}"): use ${STATUS_SINC.join(", ")}.`);
  }

  // "essenciais" é fixo (sempre presente): pedi-lo é inofensivo, não é erro.
  const gruposPedidos = lista(params.grupos, 20, 40).filter((g) => g !== "essenciais");
  const invalidos = gruposPedidos.filter((g) => !GRUPOS_OPCIONAIS_SINC.includes(g));
  if (invalidos.length) erros.push(`Grupo de colunas desconhecido: ${invalidos.map((g) => `"${g.slice(0, 20)}"`).join(", ")}.`);
  const grupos = gruposPedidos.filter((g) => GRUPOS_OPCIONAIS_SINC.includes(g));

  const resumos = lerSimNao(params, "resumos", "Abas de resumo", false, enviado, erros);

  return { pedido: { de, ate, origens, status, grupos, resumos }, erros };
}

/** "2026-11-04" + n dias → "aaaa-mm-dd" (aritmética de calendário em UTC: sem fuso, sem horário de verão). */
export function somarDias(chave: string, dias: number): string {
  const d = new Date(`${chave}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * O que a TELA preenche quando abre sem parâmetros: os últimos 30 dias, contando hoje. A API nunca usa isto — um
 * download sem datas pede o histórico inteiro, e a tela é quem sugere o recorte típico.
 */
export function periodoPadraoDaTela(hojeKey: string): { de: string; ate: string } {
  return { de: somarDias(hojeKey, -29), ate: hojeKey };
}

export function descreverPedidoSincronizacoes(p: PedidoSincronizacoes): Array<[string, string]> {
  const periodo = p.de && p.ate ? `${dataBr(p.de)} a ${dataBr(p.ate)}` : p.de ? `a partir de ${dataBr(p.de)}` : p.ate ? `até ${dataBr(p.ate)}` : "todo o histórico (sem filtro de data)";
  return [
    ["Período (início da rodada)", `${periodo} — ${rotuloDoFuso()}`],
    ["Origem", p.origens.length ? p.origens.map(rotuloOrigemSinc).join("; ") : "todas"],
    ["Status", p.status.length ? p.status.map(rotuloStatusSinc).join("; ") : "todos"],
  ];
}

/** Nome do arquivo: ASCII, sem espaço. "Sincronizacoes_2026-10-05_a_2026-11-04.xlsx". */
export function nomeDoArquivoSincronizacoes(p: PedidoSincronizacoes, hojeIso: string, extensao = "xlsx"): string {
  let periodo: string;
  if (p.de && p.ate) periodo = `${p.de}_a_${p.ate}`;
  else if (p.de) periodo = `desde_${p.de}`;
  else if (p.ate) periodo = `ate_${p.ate}`;
  else periodo = `todo-o-historico_${hojeIso}`;
  const filtrado = p.origens.length > 0 || p.status.length > 0;
  return `Sincronizacoes_${periodo}${filtrado ? "_filtrado" : ""}.${extensao}`;
}

/** Teto de linhas por exportação, com a dica de como reduzir o recorte. */
export function exigirDentroDoTeto(contagem: number, max: number = MAX_LINHAS): void {
  if (contagem > max) {
    throw new ExportacaoGrandeDemaisError(
      `O recorte tem ${contagem.toLocaleString("pt-BR")} rodadas e o máximo por exportação é ${max.toLocaleString("pt-BR")}. ` +
        "Filtre por data (Data inicial e Data final) ou por origem e status para reduzir o recorte.",
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Do pedido para a consulta
// ---------------------------------------------------------------------------------------------------------------

/**
 * "aaaa-mm-dd" → o INSTANTE em que esse dia começa no fuso do app (00:00 de Fortaleza = 03:00 UTC). Comparar a data
 * como se fosse UTC deslizaria uma rodada das 22h para o dia seguinte.
 */
export function instanteDoInicioDoDia(chave: string): Date {
  return fromZonedTime(`${chave}T00:00:00.000`, APP_TZ);
}

/**
 * Os limites do pedido como instantes: `de` inclusive; `ateExclusivo` é o início do dia SEGUINTE a `ate`, o que inclui
 * o dia inteiro (até 23:59:59.999). O dia seguinte vem de aritmética de calendário, não de "+24 h" (que erra na
 * virada de horário de verão).
 */
export function limitesDoPedido(p: Pick<PedidoSincronizacoes, "de" | "ate">): { de: Date | null; ateExclusivo: Date | null } {
  return {
    de: p.de ? instanteDoInicioDoDia(p.de) : null,
    ateExclusivo: p.ate ? instanteDoInicioDoDia(somarDias(p.ate, 1)) : null,
  };
}

/** O pedido como condição do banco. Sem filtro nenhum devolve `{}` (todas as rodadas). */
export function condicaoSincronizacoes(p: PedidoSincronizacoes): Prisma.RevenueSyncRunWhereInput {
  const { de, ateExclusivo } = limitesDoPedido(p);
  return {
    ...(de || ateExclusivo ? { iniciadoEm: { ...(de ? { gte: de } : {}), ...(ateExclusivo ? { lt: ateExclusivo } : {}) } } : {}),
    ...(p.origens.length ? { origem: { in: p.origens } } : {}),
    ...(p.status.length ? { status: { in: p.status } } : {}),
  };
}

/**
 * O que ler do banco. NUNCA `resumoPorCategoria` (JSON grande, que a planilha não usa). `erro` vem sempre (as contagens
 * de "com erro" precisam); `entradaManual` só com o grupo "tecnico".
 */
export function selecaoRodadas(comTecnico: boolean): Prisma.RevenueSyncRunSelect {
  return {
    id: true,
    iniciadoEm: true,
    concluidoEm: true,
    periodoInicio: true,
    periodoFim: true,
    origem: true,
    status: true,
    totalLinhasCR: true,
    totalLinhasLV: true,
    totalSemLV: true,
    totalLinhasNovas: true,
    totalLinhasAtualizadas: true,
    totalLinhasOrfasPreservadas: true,
    totalFaturasComConflito: true,
    totalRecebido: true,
    diferencaConferencia: true,
    erro: true,
    ...(comTecnico ? { entradaManual: true } : {}),
  };
}

/** O que a consulta devolve (estrutural: `Prisma.Decimal` e `decimal.js` servem). */
export interface RowRodada {
  id: string;
  iniciadoEm: Date;
  concluidoEm: Date | null;
  periodoInicio: Date;
  periodoFim: Date;
  origem: string;
  status: string;
  totalLinhasCR: number;
  totalLinhasLV: number;
  totalSemLV: number;
  totalLinhasNovas: number;
  totalLinhasAtualizadas: number;
  totalLinhasOrfasPreservadas: number;
  totalFaturasComConflito: number;
  totalRecebido: { toFixed(casas: number): string };
  diferencaConferencia: { toFixed(casas: number): string };
  erro: string | null;
  entradaManual?: unknown;
}

/**
 * `entradaManual` (só em origem IMPORTACAO) → "arquivo (Contas a Receber, 1a2b3c4d) · arquivo (Listar Vendas, 5e6f7a8b)",
 * o mesmo formato do detalhe da rodada. Forma inesperada NÃO derruba a exportação nem some: sai marcada, com o JSON
 * cortado em 200 caracteres.
 */
export function descreverArquivosImportados(entrada: unknown): string | null {
  if (entrada === null || entrada === undefined) return null;
  const arquivo = (v: unknown): { nome: string; sha256: string } | null => {
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    return typeof o.nome === "string" && typeof o.sha256 === "string" ? { nome: o.nome, sha256: o.sha256 } : null;
  };
  const o = typeof entrada === "object" && !Array.isArray(entrada) ? (entrada as Record<string, unknown>) : null;
  const cr = o ? arquivo(o.contasReceber) : null;
  const lv = o ? arquivo(o.listarVendas) : null;
  if (cr && lv) return `${cr.nome} (Contas a Receber, ${cr.sha256.slice(0, 8)}) · ${lv.nome} (Listar Vendas, ${lv.sha256.slice(0, 8)})`;
  return `[formato não reconhecido] ${(JSON.stringify(entrada) ?? "").slice(0, 200)}`;
}

export function paraLinhaRodada(r: RowRodada, comTecnico: boolean): LinhaRodada {
  const temErro = r.erro !== null && r.erro !== "";
  let duracaoSegundos: number | null = null;
  if (r.concluidoEm) {
    const s = Math.round((r.concluidoEm.getTime() - r.iniciadoEm.getTime()) / 1000);
    duracaoSegundos = s === 0 ? 0 : s; // (normaliza -0)
  }
  return {
    id: r.id,
    iniciadoEm: paraParede(r.iniciadoEm),
    concluidoEm: r.concluidoEm ? paraParede(r.concluidoEm) : null,
    duracaoSegundos,
    periodoInicio: r.periodoInicio,
    periodoFim: r.periodoFim,
    origem: r.origem,
    status: r.status,
    faturasCR: r.totalLinhasCR,
    itensLV: r.totalLinhasLV,
    semLV: r.totalSemLV,
    linhasNovas: r.totalLinhasNovas,
    linhasAtualizadas: r.totalLinhasAtualizadas,
    orfasPreservadas: r.totalLinhasOrfasPreservadas,
    faturasComConflito: r.totalFaturasComConflito,
    totalRecebido: r.totalRecebido.toFixed(2),
    diferencaConferencia: r.diferencaConferencia.toFixed(2),
    temErro,
    erro: comTecnico && temErro ? r.erro : null,
    arquivosImportados: comTecnico ? descreverArquivosImportados(r.entradaManual) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência contra o banco (pura: recebe os números, devolve o que NÃO fechou)
// ---------------------------------------------------------------------------------------------------------------

export interface ReferenciaBancoSinc {
  contagem: number;
  /** Contagem do banco por "ORIGEM|STATUS" (valores crus, como gravados). */
  porOrigemStatus: Map<string, number>;
  /** Rodadas com texto de erro gravado. */
  comErro: number;
  /** Soma de cada coluna de contagem, lida do banco. */
  somaInteiros: {
    faturasCR: number;
    itensLV: number;
    semLV: number;
    linhasNovas: number;
    linhasAtualizadas: number;
    orfasPreservadas: number;
    faturasComConflito: number;
  };
  /** Soma lida do banco ("1234.56"). SÓ para conferir a leitura — o arquivo nunca mostra a soma entre rodadas. */
  somaDinheiro: { totalRecebido: string; diferencaConferencia: string };
}

export const chaveOrigemStatus = (origem: string, status: string): string => `${origem}|${status}`;

/**
 * O que está em memória bate com o que o BANCO conta e soma pelo mesmo filtro, na mesma leitura? Pega leitura
 * truncada, linha repetida por paginação instável, status/origem trocados e valor lido errado. A soma de dinheiro
 * aqui é uma verificação INTERNA de leitura — não é um total que se apresente (ver o aviso do topo do arquivo).
 */
export function conferirContraBancoSinc(linhas: LinhaRodada[], ref: ReferenciaBancoSinc): string[] {
  const problemas: string[] = [];
  if (linhas.length !== ref.contagem) problemas.push(`rodadas lidas (${linhas.length}) ≠ contagem do banco (${ref.contagem})`);

  const distintos = new Set(linhas.map((l) => l.id)).size;
  if (distintos !== linhas.length) problemas.push(`${linhas.length - distintos} rodada(s) repetida(s) na leitura (paginação instável)`);

  const local = new Map<string, number>();
  for (const l of linhas) local.set(chaveOrigemStatus(l.origem, l.status), (local.get(chaveOrigemStatus(l.origem, l.status)) ?? 0) + 1);
  for (const k of new Set([...local.keys(), ...ref.porOrigemStatus.keys()])) {
    const a = local.get(k) ?? 0;
    const b = ref.porOrigemStatus.get(k) ?? 0;
    if (a !== b) problemas.push(`origem|status "${k}": lidas ${a}, banco ${b}`);
  }

  const comErro = linhas.filter((l) => l.temErro).length;
  if (comErro !== ref.comErro) problemas.push(`rodadas com erro lidas (${comErro}) ≠ banco (${ref.comErro})`);

  const somaInt = (f: (l: LinhaRodada) => number): number => linhas.reduce((a, l) => a + f(l), 0);
  const inteiros: Array<[string, number, number]> = [
    ["Faturas CR", somaInt((l) => l.faturasCR), ref.somaInteiros.faturasCR],
    ["Itens LV", somaInt((l) => l.itensLV), ref.somaInteiros.itensLV],
    ["Sem LV", somaInt((l) => l.semLV), ref.somaInteiros.semLV],
    ["Linhas novas", somaInt((l) => l.linhasNovas), ref.somaInteiros.linhasNovas],
    ["Atualizadas", somaInt((l) => l.linhasAtualizadas), ref.somaInteiros.linhasAtualizadas],
    ["Órfãs preservadas", somaInt((l) => l.orfasPreservadas), ref.somaInteiros.orfasPreservadas],
    ["Faturas com conflito", somaInt((l) => l.faturasComConflito), ref.somaInteiros.faturasComConflito],
  ];
  for (const [nome, lido, banco] of inteiros) if (lido !== banco) problemas.push(`soma de "${nome}" lida (${lido}) ≠ banco (${banco})`);

  const totalLido = toAmountString(sum(linhas.map((l) => l.totalRecebido)));
  if (totalLido !== toAmountString(money(ref.somaDinheiro.totalRecebido))) problemas.push(`soma de "Total recebido" lida (${totalLido}) ≠ banco (${ref.somaDinheiro.totalRecebido})`);
  const difLida = toAmountString(sum(linhas.map((l) => l.diferencaConferencia)));
  if (difLida !== toAmountString(money(ref.somaDinheiro.diferencaConferencia))) {
    problemas.push(`soma de "Diferença de conferência" lida (${difLida}) ≠ banco (${ref.somaDinheiro.diferencaConferencia})`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------
// Agregados: resumo geral, por origem e status, por dia
// ---------------------------------------------------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, "0");

/** "04/11/2026 17:53" de um relógio de parede (os campos UTC do Date SÃO o relógio — não reconverter de fuso). */
export function relogioBr(parede: Date): string {
  return `${p2(parede.getUTCDate())}/${p2(parede.getUTCMonth() + 1)}/${parede.getUTCFullYear()} ${p2(parede.getUTCHours())}:${p2(parede.getUTCMinutes())}`;
}

/** O dia ("aaaa-mm-dd") em que a rodada COMEÇOU, no fuso do app (o relógio de parede já está no fuso). */
export const diaDe = (l: Pick<LinhaRodada, "iniciadoEm">): string => l.iniciadoEm.toISOString().slice(0, 10);

export interface ResumoRodadas {
  rodadas: number;
  concluidas: number;
  falhas: number;
  emAndamento: number;
  /** Status fora do padrão (nunca reclassificado). */
  outroStatus: number;
  statusDesconhecidos: string[];
  comErro: number;
  /** Diferença de conferência diferente de zero. */
  comDiferenca: number;
  comConflito: number;
  /** Conclusão anterior ao início (relógios dessincronizados?). */
  conclusaoAntesDoInicio: number;
  primeira: Date | null;
  maisRecente: Date | null;
}

export function resumirRodadas(linhas: LinhaRodada[]): ResumoRodadas {
  const r: ResumoRodadas = {
    rodadas: linhas.length,
    concluidas: 0,
    falhas: 0,
    emAndamento: 0,
    outroStatus: 0,
    statusDesconhecidos: [],
    comErro: 0,
    comDiferenca: 0,
    comConflito: 0,
    conclusaoAntesDoInicio: 0,
    primeira: null,
    maisRecente: null,
  };
  const desconhecidos = new Set<string>();
  for (const l of linhas) {
    if (l.status === "DONE") r.concluidas += 1;
    else if (l.status === "FAILED") r.falhas += 1;
    else if (l.status === "RUNNING") r.emAndamento += 1;
    else {
      r.outroStatus += 1;
      desconhecidos.add(l.status);
    }
    if (l.temErro) r.comErro += 1;
    if (!money(l.diferencaConferencia).isZero()) r.comDiferenca += 1;
    if (l.faturasComConflito > 0) r.comConflito += 1;
    if (l.duracaoSegundos !== null && l.duracaoSegundos < 0) r.conclusaoAntesDoInicio += 1;
    if (r.primeira === null || l.iniciadoEm < r.primeira) r.primeira = l.iniciadoEm;
    if (r.maisRecente === null || l.iniciadoEm > r.maisRecente) r.maisRecente = l.iniciadoEm;
  }
  r.statusDesconhecidos = [...desconhecidos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return r;
}

export interface GrupoOrigemStatus {
  origem: string;
  status: string;
  rodadas: number;
  comErro: number;
  primeira: Date;
  ultima: Date;
}

/** Contagens por origem e status (origem na ordem do catálogo, depois status; valores fora do catálogo ao fim). */
export function agruparPorOrigemStatus(linhas: LinhaRodada[]): GrupoOrigemStatus[] {
  const mapa = new Map<string, GrupoOrigemStatus>();
  for (const l of linhas) {
    const k = chaveOrigemStatus(l.origem, l.status);
    const g = mapa.get(k);
    if (!g) {
      mapa.set(k, { origem: l.origem, status: l.status, rodadas: 1, comErro: l.temErro ? 1 : 0, primeira: l.iniciadoEm, ultima: l.iniciadoEm });
    } else {
      g.rodadas += 1;
      if (l.temErro) g.comErro += 1;
      if (l.iniciadoEm < g.primeira) g.primeira = l.iniciadoEm;
      if (l.iniciadoEm > g.ultima) g.ultima = l.iniciadoEm;
    }
  }
  return [...mapa.values()].sort(
    (a, b) =>
      posicao(ORIGENS_SINC, a.origem) - posicao(ORIGENS_SINC, b.origem) ||
      a.origem.localeCompare(b.origem, "pt-BR") ||
      posicao(STATUS_SINC, a.status) - posicao(STATUS_SINC, b.status) ||
      a.status.localeCompare(b.status, "pt-BR"),
  );
}

export interface DiaSinc {
  /** "aaaa-mm-dd" */
  dia: string;
  rodadas: number;
  concluidas: number;
  falhas: number;
  emAndamento: number;
  outras: number;
  /** A conclusão mais tardia entre as rodadas concluídas do dia (relógio de parede). */
  ultimaConcluida: Date | null;
}

/**
 * Os dias a listar. Dia SEM rodada nenhuma entra com zeros — é justamente o dia em que a sincronização parou de tentar,
 * e uma tabela só com os dias que têm rodada o esconderia. Começa em `de` (ou na primeira rodada) e termina em `ate`,
 * sem passar de hoje (não existe rodada no futuro); sem `ate`, vai até hoje. Nunca corta um dia que tenha rodada.
 */
export function faixaDeDias(o: { de: string | null; ate: string | null; hoje: string; primeiroDia: string | null; ultimoDia: string | null }): { inicio: string; fim: string } | null {
  const inicio = o.de ?? o.primeiroDia;
  if (!inicio) return null;
  let fim = o.ate !== null && o.ate < o.hoje ? o.ate : o.hoje;
  if (o.ultimoDia !== null && o.ultimoDia > fim) fim = o.ultimoDia;
  if (inicio > fim) return null; // o pedido está inteiro no futuro
  return { inicio, fim };
}

export function agruparPorDia(linhas: LinhaRodada[], faixa: { inicio: string; fim: string } | null): DiaSinc[] {
  const vazio = (dia: string): DiaSinc => ({ dia, rodadas: 0, concluidas: 0, falhas: 0, emAndamento: 0, outras: 0, ultimaConcluida: null });
  const mapa = new Map<string, DiaSinc>();
  if (faixa) for (let d = faixa.inicio; d <= faixa.fim; d = somarDias(d, 1)) mapa.set(d, vazio(d));
  for (const l of linhas) {
    const dia = diaDe(l);
    let x = mapa.get(dia);
    if (!x) {
      x = vazio(dia); // (fora da faixa: não deveria acontecer; entra mesmo assim para o resumo nunca perder uma rodada)
      mapa.set(dia, x);
    }
    x.rodadas += 1;
    if (l.status === "DONE") {
      x.concluidas += 1;
      const fim = l.concluidoEm ?? l.iniciadoEm;
      if (x.ultimaConcluida === null || fim > x.ultimaConcluida) x.ultimaConcluida = fim;
    } else if (l.status === "FAILED") x.falhas += 1;
    else if (l.status === "RUNNING") x.emAndamento += 1;
    else x.outras += 1;
  }
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Os resumos fecham com o detalhe? Devolve o que NÃO fechou. */
export function conferirAgregados(linhas: LinhaRodada[], porOrigemStatus: GrupoOrigemStatus[], porDia: DiaSinc[]): string[] {
  const problemas: string[] = [];
  const soma = <T>(xs: T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);
  const comErro = linhas.filter((l) => l.temErro).length;
  if (soma(porOrigemStatus, (g) => g.rodadas) !== linhas.length) {
    problemas.push(`Por origem e status soma ${soma(porOrigemStatus, (g) => g.rodadas)} rodadas, o detalhe tem ${linhas.length}`);
  }
  if (soma(porOrigemStatus, (g) => g.comErro) !== comErro) {
    problemas.push(`Por origem e status soma ${soma(porOrigemStatus, (g) => g.comErro)} rodadas com erro, o detalhe tem ${comErro}`);
  }
  if (soma(porDia, (d) => d.rodadas) !== linhas.length) {
    problemas.push(`Por dia soma ${soma(porDia, (d) => d.rodadas)} rodadas, o detalhe tem ${linhas.length}`);
  }
  for (const d of porDia) {
    const partes = d.concluidas + d.falhas + d.emAndamento + d.outras;
    if (partes !== d.rodadas) problemas.push(`Por dia ${d.dia}: ${d.rodadas} rodadas, mas concluídas + falhas + em andamento + outras = ${partes}`);
  }
  return problemas;
}

/**
 * O filtro de datas (instantes no fuso do app) e o dia que o resumo atribui a cada rodada concordam? Uma rodada fora
 * do período pedido denuncia limite calculado em UTC em vez de no fuso do app.
 */
export function conferirRecorteDeDatas(linhas: LinhaRodada[], pedido: Pick<PedidoSincronizacoes, "de" | "ate">): string[] {
  const fora = linhas.filter((l) => {
    const d = diaDe(l);
    return (pedido.de !== null && d < pedido.de) || (pedido.ate !== null && d > pedido.ate);
  });
  if (!fora.length) return [];
  return [`${fora.length} rodada(s) fora do período pedido (${pedido.de ?? "…"} a ${pedido.ate ?? "…"}): o filtro de datas e o agrupamento por dia discordam`];
}

// ---------------------------------------------------------------------------------------------------------------
// Montagem das abas
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaPastaSinc {
  linhas: LinhaRodada[];
  pedido: PedidoSincronizacoes;
  geradoEm: Date;
  usuario: UsuarioExport;
  frescor: { texto: string; alerta: boolean };
  /** "aaaa-mm-dd" — hoje, no fuso do app (o limite da aba "Por dia"). */
  hoje: string;
}

export interface SaidaPastaSinc {
  abas: Sheet[];
  detalhe: Detalhe;
  titulosDasColunas: string[];
  resumo: ResumoRodadas;
}

function abaPorOrigemEStatus(grupos: GrupoOrigemStatus[], resumo: ResumoRodadas): Sheet {
  return abaDeTabela({
    nome: "Por origem e status",
    colunas: [
      { titulo: "Origem", tipo: "texto", largura: 16 },
      { titulo: "Status", tipo: "texto", largura: 16 },
      { titulo: "Rodadas", tipo: "inteiro", largura: 11 },
      { titulo: "Com erro registrado", tipo: "inteiro", largura: 20 },
      { titulo: "Primeira rodada", tipo: "datahora", largura: 17 },
      { titulo: "Rodada mais recente", tipo: "datahora", largura: 19 },
    ],
    linhas: grupos.map((g) => [rotuloOrigemSinc(g.origem), rotuloStatusSinc(g.status), g.rodadas, g.comErro, g.primeira, g.ultima]),
    total: ["TOTAL", null, resumo.rodadas, resumo.comErro, null, null],
    nota: "Rodadas = linhas da aba Rodadas. 'Com erro registrado' conta as rodadas que têm texto de erro gravado (o texto está na aba Rodadas, no grupo Detalhe técnico, somente administrador).",
    autoFiltro: false,
  });
}

function abaPorDia(dias: DiaSinc[], total: { rodadas: number; concluidas: number; falhas: number; emAndamento: number; outras: number }, hoje: string, chegaAteHoje: boolean): Sheet {
  const temOutras = dias.some((d) => d.outras > 0);
  const colunas: ColunaTabela[] = [
    { titulo: "Dia", tipo: "data", largura: 13 },
    { titulo: "Rodadas", tipo: "inteiro", largura: 11 },
    { titulo: "Concluídas", tipo: "inteiro", largura: 12 },
    { titulo: "Falhas", tipo: "inteiro", largura: 9 },
    { titulo: "Em andamento", tipo: "inteiro", largura: 14 },
    ...(temOutras ? ([{ titulo: "Outro status", tipo: "inteiro", largura: 13 }] as ColunaTabela[]) : []),
    { titulo: "Última concluída em", tipo: "datahora", largura: 20 },
  ];
  return abaDeTabela({
    nome: "Por dia",
    colunas,
    linhas: dias.map((d) => [
      new Date(`${d.dia}T00:00:00.000Z`),
      d.rodadas,
      d.concluidas,
      d.falhas,
      d.emAndamento,
      ...(temOutras ? [d.outras] : []),
      d.ultimaConcluida,
    ]),
    total: ["TOTAL", total.rodadas, total.concluidas, total.falhas, total.emAndamento, ...(temOutras ? [total.outras] : []), null],
    nota:
      `O dia é o do INÍCIO da rodada (${rotuloDoFuso()}). Dia sem nenhuma rodada aparece com zero: com filtro de origem ou status, zero quer dizer nenhuma rodada que atenda ao filtro. ` +
      "'Última concluída em' é a conclusão mais tardia entre as rodadas concluídas daquele dia." +
      (chegaAteHoje ? ` Hoje (${dataBr(hoje)}) está em andamento.` : ""),
  });
}

export function montarAbasSincronizacoes(e: EntradaPastaSinc): SaidaPastaSinc {
  const { linhas, pedido } = e;
  const colunas = colunasSinc(pedido.grupos);
  const comTecnico = pedido.grupos.includes("tecnico");
  // SEM `colunaTotal`: dinheiro de rodadas diferentes não se soma (ver o aviso do topo do arquivo).
  const detalhe = abaDeDetalhe({ nome: NOME_ABA_PRINCIPAL_SINC, colunas, linhas });
  const resumo = resumirRodadas(linhas);

  const divergencias: string[] = [...conferirRecorteDeDatas(linhas, pedido)];

  const abasDeResumo: Sheet[] = [];
  let chegaAteHoje = false;
  if (pedido.resumos) {
    const porOrigemStatus = agruparPorOrigemStatus(linhas);
    let primeiroDia: string | null = null;
    let ultimoDia: string | null = null;
    for (const l of linhas) {
      const d = diaDe(l);
      if (primeiroDia === null || d < primeiroDia) primeiroDia = d;
      if (ultimoDia === null || d > ultimoDia) ultimoDia = d;
    }
    const faixa = faixaDeDias({ de: pedido.de, ate: pedido.ate, hoje: e.hoje, primeiroDia, ultimoDia });
    const porDia = agruparPorDia(linhas, faixa);
    chegaAteHoje = faixa !== null && faixa.fim === e.hoje;
    divergencias.push(...conferirAgregados(linhas, porOrigemStatus, porDia));
    abasDeResumo.push(
      abaPorOrigemEStatus(porOrigemStatus, resumo),
      abaPorDia(porDia, { rodadas: resumo.rodadas, concluidas: resumo.concluidas, falhas: resumo.falhas, emAndamento: resumo.emAndamento, outras: resumo.outroStatus }, e.hoje, chegaAteHoje),
    );
  }
  if (divergencias.length) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${divergencias.join("; ")}.`);
  }

  // --- Leia-me ---------------------------------------------------------------------------------------------------
  const n = (x: number) => x.toLocaleString("pt-BR");
  const avisos = [
    "Cada linha da aba Rodadas é UMA rodada de sincronização de receita. A sincronização automática repete a rodada em intervalos curtos e recalcula o MESMO período a cada vez, por isso há muitas rodadas quase iguais.",
    "NÃO some 'Total recebido' nem 'Diferença de conferência' entre rodadas: cada valor é o que AQUELA rodada calculou na hora (um retrato do momento) e pode não bater com o Panorama de hoje, que reflete revisões e sincronizações posteriores. " +
      "Por isso esta planilha não tem linha de total nem subtotal de dinheiro; para a receita de um período, use a exportação de Receita.",
    "'Diferença de conferência' é a soma de 'Valor Recebido' das faturas aceitas menos a soma de 'Valor Recebido Cat.' produzida pela rodada. O esperado é 0,00; qualquer outro valor pede investigação (veja a rodada no painel).",
    "Origem — Automática: o sistema baixou os exports do Conexa sozinho. Manual: alguém disparou o download pelo sistema. Importação: os arquivos foram enviados por uma pessoa, então o dado vale só até onde o arquivo alcança.",
    "Status — Concluída: terminou. Falhou: terminou com erro. Sincronizando: estava em andamento quando o arquivo foi gerado (uma rodada interrompida é marcada como falha na tentativa seguinte). Rodada sem conclusão fica sem hora de conclusão e sem duração.",
    "Linhas novas, Atualizadas e Órfãs preservadas contam o que a rodada fez nas linhas de receita (inserir, atualizar no lugar, preservar a linha revisada manualmente cujo bucket não apareceu). 'Faturas com conflito' são faturas com possível dupla contagem, que exigem revisão humana.",
    `Horários no ${rotuloDoFuso()}. 'Período de' e 'Período até' são datas puras: o intervalo de Data de Crédito que a rodada processou.`,
  ];
  if (pedido.resumos) {
    avisos.push(
      `A aba Por dia agrupa pelo dia do INÍCIO da rodada. Dia sem nenhuma rodada que atenda ao filtro aparece com zero${chegaAteHoje ? `; hoje (${dataBr(e.hoje)}) está em andamento` : ""}.`,
    );
  }
  if (comTecnico) {
    avisos.push(
      "Esta planilha traz o texto de erro e os nomes dos arquivos importados (Detalhe técnico): podem citar endereços, trechos do sistema e nomes de arquivos. Trate como informação interna e não a encaminhe a quem não precisa.",
    );
  }
  if (resumo.conclusaoAntesDoInicio > 0) {
    avisos.push(`${n(resumo.conclusaoAntesDoInicio)} rodada(s) têm conclusão ANTERIOR ao início (relógios dessincronizados?): a duração dessas linhas aparece negativa, sem ajuste.`);
  }
  if (resumo.outroStatus > 0) {
    avisos.push(`${n(resumo.outroStatus)} rodada(s) têm status fora do padrão (${resumo.statusDesconhecidos.join(", ")}): aparecem como vieram, sem reclassificar.`);
  }

  const leiaMe = abaLeiaMe({
    titulo: "Exportação das sincronizações de receita — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: `${e.usuario.nome} (${e.usuario.email})`,
    filtros: descreverPedidoSincronizacoes(pedido),
    resultado: [
      ["Rodadas exportadas", n(resumo.rodadas)],
      ["Concluídas", n(resumo.concluidas)],
      ["Falharam", n(resumo.falhas)],
      ["Sincronizando (em andamento)", n(resumo.emAndamento)],
      ...(resumo.outroStatus > 0 ? ([["Com outro status", n(resumo.outroStatus)]] as Array<[string, string]>) : []),
      ...(resumo.primeira && resumo.maisRecente
        ? ([
            ["Primeira rodada no arquivo", relogioBr(resumo.primeira)],
            ["Rodada mais recente no arquivo", relogioBr(resumo.maisRecente)],
          ] as Array<[string, string]>)
        : []),
      ["Rodadas com erro registrado", n(resumo.comErro)],
      ["Rodadas com diferença de conferência", n(resumo.comDiferenca)],
      ["Rodadas com faturas em conflito", n(resumo.comConflito)],
      [`Colunas da aba ${NOME_ABA_PRINCIPAL_SINC}`, colunas.map((c) => c.titulo).join(" · ")],
    ],
    frescor: e.frescor,
    avisos,
    conferencia:
      `OK. A contagem de rodadas (${n(resumo.rodadas)}) e as somas de cada coluna numérica foram conferidas contra o banco, na mesma leitura` +
      `${pedido.resumos ? "; as abas de resumo fecham com a aba Rodadas" : ""}; e o arquivo foi relido (cabeçalho e número de linhas) antes de entregar.`,
  });

  return { abas: [detalhe.aba, ...abasDeResumo, leiaMe], detalhe, titulosDasColunas: colunas.map((c) => c.titulo), resumo };
}
