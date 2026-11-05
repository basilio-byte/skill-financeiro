import { ORDENS, STATUS_DE_DIVIDA, ROTULO_STATUS, lerFiltros, FAIXAS_DE_ATRASO, type FiltrosInadimplencia } from "@/lib/inadimplencia/dominio";
import { formatBRL, money, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { dataBr, validarParametros, lerDataOpcional, lerSimNao, lista, um, type ParamsBrutos } from "./parametros";
import { contagem } from "./plural";
import {
  abaDeDetalhe,
  abaDeTabela,
  abaLeiaMe,
  type ColunaTabela,
  type Detalhe,
} from "./planilha";
import { ExportacaoInconsistenteError, type ColunaDef, type GrupoDef, type UsuarioExport } from "./tipos";

/**
 * Exportação de INADIMPLENTES — a parte PURA (ADR-0035): filtros, colunas e montagem das abas. Sem banco.
 *
 * O filtro é o MESMO da tela /inadimplentes (`condicao` de consulta.ts, usado pela parte do servidor), e a lista é a
 * mesma: cobranças `unpaid`/`protested`/`juridical` com vencimento anterior a hoje; `negotiated` fica fora (listá-la
 * dobraria a dívida). O valor é o `currentAmount` (COM juros e multa) quando existe — a mesma régua do Conexa.
 */

// ---------------------------------------------------------------------------------------------------------------
// Linha e colunas
// ---------------------------------------------------------------------------------------------------------------

export interface LinhaInadimplencia {
  conexaId: number;
  customerConexaId: number | null;
  cliente: string;
  unidade: string | null;
  status: string;
  tipo: string | null;
  /** Com juros e multa. */
  valor: string;
  valorOriginal: string;
  vencimento: Date;
  competencia: Date | null;
  diasDeAtraso: number;
  /** Relógio de parede (fuso do app). */
  atualizadoNoConexa: Date | null;
  /** Relógio de parede (fuso do app). */
  sincronizadoEm: Date;
  telefone: string | null;
  email: string | null;
}

export const rotuloStatus = (s: string): string => ROTULO_STATUS[s] ?? s;

export const GRUPOS_INAD: GrupoDef[] = [
  { id: "essenciais", rotulo: "Essenciais", descricao: "Cobrança, cliente, unidade, situação, vencimento, dias de atraso e valores.", somenteAdmin: false, padrao: true, fixo: true },
  { id: "datas", rotulo: "Datas de controle", descricao: "Competência, última atualização no Conexa e quando o painel sincronizou.", somenteAdmin: false, padrao: false },
  { id: "contato", rotulo: "Contato do cliente", descricao: "Telefone e e-mail (dados pessoais). Somente administrador.", somenteAdmin: true, padrao: false },
];

const juros = (l: LinhaInadimplencia): string => toAmountString(money(l.valor).minus(money(l.valorOriginal)));

export const COLUNAS_INAD: ColunaDef<LinhaInadimplencia>[] = [
  { id: "idCobranca", titulo: "ID Cobrança", grupo: "essenciais", tipo: "id", largura: 12, valor: (l) => l.conexaId, campos: ["conexaId"] },
  { id: "idCliente", titulo: "ID Cliente", grupo: "essenciais", tipo: "id", largura: 11, valor: (l) => l.customerConexaId, campos: ["customerConexaId"] },
  { id: "cliente", titulo: "Cliente", grupo: "essenciais", tipo: "texto", largura: 42, valor: (l) => l.cliente, campos: ["cliente"] },
  { id: "unidade", titulo: "Unidade", grupo: "essenciais", tipo: "texto", largura: 20, valor: (l) => l.unidade, campos: ["unidade"] },
  { id: "situacao", titulo: "Situação", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => rotuloStatus(l.status), campos: ["status"] },
  { id: "tipo", titulo: "Tipo", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => l.tipo, campos: ["tipo"] },
  { id: "vencimento", titulo: "Vencimento", grupo: "essenciais", tipo: "data", largura: 13, valor: (l) => l.vencimento, campos: ["vencimento"] },
  { id: "dias", titulo: "Dias de atraso", grupo: "essenciais", tipo: "inteiro", largura: 10, valor: (l) => l.diasDeAtraso, campos: ["diasDeAtraso"] },
  { id: "valor", titulo: "Valor (com juros e multa)", grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.valor, campos: ["valor"] },
  { id: "valorOriginal", titulo: "Valor original", grupo: "essenciais", tipo: "dinheiro", largura: 16, valor: (l) => l.valorOriginal, campos: ["valorOriginal"] },
  { id: "juros", titulo: "Juros e multa", grupo: "essenciais", tipo: "dinheiro", largura: 14, valor: juros, campos: ["valor", "valorOriginal"] },
  { id: "competencia", titulo: "Competência", grupo: "datas", tipo: "data", largura: 13, valor: (l) => l.competencia, campos: ["competencia"] },
  { id: "atualizadoNoConexa", titulo: "Atualizada no Conexa em", grupo: "datas", tipo: "datahora", largura: 19, valor: (l) => l.atualizadoNoConexa, campos: ["atualizadoNoConexa"] },
  { id: "sincronizadoEm", titulo: "Sincronizada no painel em", grupo: "datas", tipo: "datahora", largura: 19, valor: (l) => l.sincronizadoEm, campos: ["sincronizadoEm"] },
  { id: "telefone", titulo: "Telefone", grupo: "contato", tipo: "texto", largura: 18, valor: (l) => l.telefone, campos: ["telefone"] },
  { id: "email", titulo: "E-mail", grupo: "contato", tipo: "texto", largura: 32, valor: (l) => l.email, campos: ["email"] },
];

export const COLUNA_VALOR_INAD = "valor";
export const GRUPOS_OPCIONAIS_INAD = GRUPOS_INAD.filter((g) => !g.fixo).map((g) => g.id);

export function colunasInad(grupos: readonly string[]): ColunaDef<LinhaInadimplencia>[] {
  const ativos = new Set<string>(["essenciais", ...grupos]);
  return COLUNAS_INAD.filter((c) => ativos.has(c.grupo));
}

export function grupoInadPermitido(g: string, papel: UsuarioExport["papel"]): boolean {
  const def = GRUPOS_INAD.find((x) => x.id === g);
  return !!def && (!def.somenteAdmin || papel === "ADMIN");
}

// ---------------------------------------------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------------------------------------------

export interface PedidoInadimplencia {
  /** Os filtros no formato do código da tela (mesma `condicao`). */
  filtros: FiltrosInadimplencia;
  grupos: string[];
  resumos: boolean;
}

export function lerPedidoInadimplencia(params: ParamsBrutos): { pedido: PedidoInadimplencia; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f", "de", "ate", "q", "status", "unidade", "ordem", "dir", "resumos"], erros);

  const de = lerDataOpcional(params, "de", "Vencimento inicial", erros);
  const ate = lerDataOpcional(params, "ate", "Vencimento final", erros);
  if (de && ate && de > ate) erros.push("O vencimento inicial é depois do final.");

  const status = um(params.status);
  if (status && !(STATUS_DE_DIVIDA as readonly string[]).includes(status)) {
    erros.push(`Situação desconhecida ("${status.slice(0, 20)}"): use ${STATUS_DE_DIVIDA.join(", ")}.`);
  }
  const ordem = um(params.ordem);
  if (ordem && !(ORDENS as readonly string[]).includes(ordem)) erros.push(`Ordenação desconhecida ("${ordem.slice(0, 20)}"): use ${ORDENS.join(" ou ")}.`);
  const dir = um(params.dir);
  if (dir && dir !== "asc" && dir !== "desc") erros.push(`Direção desconhecida ("${dir.slice(0, 20)}"): use asc ou desc.`);
  if (um(params.q).length > 80) erros.push("A busca por cliente aceita até 80 caracteres.");
  if (um(params.unidade).length > 60) erros.push("A unidade aceita até 60 caracteres.");

  const pedidos = lista(params.grupos, 20, 40).filter((g) => g !== "essenciais");
  const invalidos = pedidos.filter((g) => !GRUPOS_OPCIONAIS_INAD.includes(g));
  if (invalidos.length) erros.push(`Grupo de colunas desconhecido: ${invalidos.map((g) => `"${g.slice(0, 20)}"`).join(", ")}.`);
  // Grupo pedido de forma explícita vale com ou sem `f=1` (o padrão é nenhum grupo opcional).
  const grupos = pedidos.filter((g) => GRUPOS_OPCIONAIS_INAD.includes(g));
  const resumos = lerSimNao(params, "resumos", "Abas de resumo", true, enviado, erros);

  // `lerFiltros` normaliza do JEITO DA TELA (mesma `condicao` depois). Já validei acima o que ele ignoraria em silêncio.
  const filtros = lerFiltros({ de: de ?? undefined, ate: ate ?? undefined, q: um(params.q), status: status || undefined, unidade: um(params.unidade), ordem: ordem || undefined, dir: dir || undefined, visao: "cobranca" });
  return { pedido: { filtros, grupos, resumos }, erros };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function descreverFiltrosInad(f: FiltrosInadimplencia): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const de = iso(f.de);
  const ate = iso(f.ate);
  out.push(["Vencimento", de && ate ? `${dataBr(de)} a ${dataBr(ate)}` : de ? `a partir de ${dataBr(de)}` : ate ? `até ${dataBr(ate)}` : "todos (sem filtro de data)"]);
  if (f.q) out.push(["Cliente (nome ou ID)", f.q]);
  if (f.status) out.push(["Situação", rotuloStatus(f.status)]);
  if (f.unidade) out.push(["Unidade", f.unidade]);
  out.push(["Ordenação", `${f.ordem === "valor" ? "valor" : "vencimento"}, ${f.direcao === "desc" ? (f.ordem === "valor" ? "maior primeiro" : "mais recente primeiro") : f.ordem === "valor" ? "menor primeiro" : "mais antigo primeiro"}`]);
  if (out.length === 2) out.splice(1, 0, ["Outros filtros", "nenhum"]);
  return out;
}

export function temFiltroInad(f: FiltrosInadimplencia): boolean {
  return !!(f.de || f.ate || f.q || f.status || f.unidade);
}

export function nomeDoArquivoInad(f: FiltrosInadimplencia, hojeIso: string, extensao = "xlsx"): string {
  return `Inadimplentes_${hojeIso}${temFiltroInad(f) ? "_filtrado" : ""}.${extensao}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Montagem das abas
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaPastaInad {
  linhas: LinhaInadimplencia[];
  pedido: PedidoInadimplencia;
  geradoEm: Date;
  usuario: UsuarioExport;
  frescor: { texto: string; alerta: boolean };
  /** "aaaa-mm-dd" — a data-base dos dias de atraso. */
  hoje: string;
}

export interface SaidaPastaInad {
  abas: Sheet[];
  detalhe: Detalhe;
  total: Money;
  clientes: number;
  titulosDasColunas: string[];
}

const PESO_STATUS: Record<string, number> = { juridical: 3, protested: 2, unpaid: 1 };

interface GrupoInad {
  chave: string;
  cobrancas: number;
  clientes: Set<string>;
  valor: Money;
}

function agruparInad(linhas: LinhaInadimplencia[], chaveDe: (l: LinhaInadimplencia) => string): GrupoInad[] {
  const mapa = new Map<string, GrupoInad>();
  for (const l of linhas) {
    const k = chaveDe(l);
    const g = mapa.get(k) ?? { chave: k, cobrancas: 0, clientes: new Set<string>(), valor: ZERO };
    g.cobrancas += 1;
    g.clientes.add(String(l.customerConexaId));
    g.valor = g.valor.plus(money(l.valor));
    mapa.set(k, g);
  }
  return [...mapa.values()];
}

export function montarAbasInadimplencia(e: EntradaPastaInad): SaidaPastaInad {
  const { linhas, pedido } = e;
  const colunas = colunasInad(pedido.grupos);
  const detalhe = abaDeDetalhe({ nome: "Por cobrança", colunas, linhas, colunaTotal: COLUNA_VALOR_INAD });
  const total = sum(linhas.map((l) => l.valor));
  const totalStr = toAmountString(total);
  const clientesDistintos = new Set(linhas.map((l) => String(l.customerConexaId))).size;
  const comContato = pedido.grupos.includes("contato");

  const pct = (parte: Money): string => (total.isZero() ? "0.00" : parte.div(total).times(100).toFixed(2));
  const abas: Sheet[] = [];
  const somasParaConferir: Array<{ nome: string; soma: Money }> = [];

  // --- Por cliente ---------------------------------------------------------------------------------------------
  type Cli = { id: number | null; cliente: string; unidade: string | null; cobrancas: number; valor: Money; maisAntiga: Date; maiorAtraso: number; pior: string; telefone: string | null; email: string | null };
  const porCliente = new Map<string, Cli>();
  for (const l of linhas) {
    const k = String(l.customerConexaId);
    const c = porCliente.get(k);
    if (!c) {
      porCliente.set(k, { id: l.customerConexaId, cliente: l.cliente, unidade: l.unidade, cobrancas: 1, valor: money(l.valor), maisAntiga: l.vencimento, maiorAtraso: l.diasDeAtraso, pior: l.status, telefone: l.telefone, email: l.email });
    } else {
      c.cobrancas += 1;
      c.valor = c.valor.plus(money(l.valor));
      if (l.vencimento < c.maisAntiga) c.maisAntiga = l.vencimento;
      c.maiorAtraso = Math.max(c.maiorAtraso, l.diasDeAtraso);
      if ((PESO_STATUS[l.status] ?? 0) > (PESO_STATUS[c.pior] ?? 0)) c.pior = l.status;
      c.telefone ??= l.telefone;
      c.email ??= l.email;
    }
  }
  const clientes = [...porCliente.values()].sort((a, b) => b.valor.comparedTo(a.valor) || (a.id ?? 0) - (b.id ?? 0));
  const colsCli: ColunaTabela[] = [
    { titulo: "ID Cliente", tipo: "id", largura: 11 },
    { titulo: "Cliente", tipo: "texto", largura: 42 },
    { titulo: "Unidade", tipo: "texto", largura: 20 },
    { titulo: "Cobranças", tipo: "inteiro", largura: 11 },
    { titulo: "Valor em atraso", tipo: "dinheiro", largura: 18 },
    { titulo: "Vencimento mais antigo", tipo: "data", largura: 14 },
    { titulo: "Maior atraso (dias)", tipo: "inteiro", largura: 12 },
    { titulo: "Pior situação", tipo: "texto", largura: 14 },
    ...(comContato ? ([{ titulo: "Telefone", tipo: "texto", largura: 18 }, { titulo: "E-mail", tipo: "texto", largura: 32 }] as ColunaTabela[]) : []),
  ];
  abas.push(
    abaDeTabela({
      nome: "Por cliente",
      colunas: colsCli,
      linhas: clientes.map((c) => [c.id, c.cliente, c.unidade, c.cobrancas, toAmountString(c.valor), c.maisAntiga, c.maiorAtraso, rotuloStatus(c.pior), ...(comContato ? [c.telefone, c.email] : [])]),
      total: ["TOTAL", null, null, linhas.length, totalStr, null, null, null, ...(comContato ? [null, null] : [])],
      nota: `${clientes.length} cliente(s). A coluna Cobranças soma as cobranças de cada cliente; o valor inclui juros e multa.`,
    }),
  );
  somasParaConferir.push({ nome: "Por cliente", soma: clientes.reduce<Money>((a, c) => a.plus(c.valor), ZERO) });

  if (pedido.resumos) {
    // --- Faixas de atraso (relativas à data-base) -------------------------------------------------------------
    const faixaDe = (dias: number): string => {
      const f = FAIXAS_DE_ATRASO.find((x) => dias >= x.minDias && (x.maxDias === null || dias <= x.maxDias));
      return f ? f.rotulo : "sem atraso (vence hoje ou depois)";
    };
    const ordemFaixas = [...FAIXAS_DE_ATRASO.map((f) => f.rotulo), "sem atraso (vence hoje ou depois)"];
    const faixas = agruparInad(linhas, (l) => faixaDe(l.diasDeAtraso)).sort((a, b) => ordemFaixas.indexOf(a.chave) - ordemFaixas.indexOf(b.chave));
    const colsResumo: ColunaTabela[] = [
      { titulo: "", tipo: "texto", largura: 36 },
      { titulo: "Cobranças", tipo: "inteiro", largura: 12 },
      { titulo: "Clientes", tipo: "inteiro", largura: 12 },
      { titulo: "Valor em atraso", tipo: "dinheiro", largura: 18 },
      { titulo: "% do total", tipo: "percentual", largura: 12 },
    ];
    const tabela = (nome: string, titulo: string, grupos: GrupoInad[], nota?: string) => {
      abas.push(
        abaDeTabela({
          nome,
          colunas: colsResumo.map((c, i) => (i === 0 ? { ...c, titulo } : c)),
          linhas: grupos.map((g) => [g.chave, g.cobrancas, g.clientes.size, toAmountString(g.valor), pct(g.valor)]),
          total: ["TOTAL", linhas.length, clientesDistintos, totalStr, "100.00"],
          nota,
          autoFiltro: false,
        }),
      );
      somasParaConferir.push({ nome, soma: grupos.reduce<Money>((a, g) => a.plus(g.valor), ZERO) });
    };
    tabela("Faixas de atraso", "Faixa de atraso", faixas, `Dias de atraso contados até ${dataBr(e.hoje)} (a data-base deste arquivo). A coluna Clientes não soma: um cliente pode ter cobranças em mais de uma faixa.`);
    tabela("Por situação", "Situação", agruparInad(linhas, (l) => rotuloStatus(l.status)).sort((a, b) => b.valor.comparedTo(a.valor)));
    tabela("Por unidade", "Unidade", agruparInad(linhas, (l) => l.unidade || "(sem unidade)").sort((a, b) => b.valor.comparedTo(a.valor)));
  }

  // --- conferência: cada aba fecha com o detalhe -----------------------------------------------------------------
  const divergencias = somasParaConferir.filter((s) => !s.soma.equals(total)).map((s) => `${s.nome}: ${toAmountString(s.soma)} ≠ ${totalStr}`);
  if (detalhe.total !== null && detalhe.total !== totalStr) divergencias.push(`Por cobrança (rodapé): ${detalhe.total} ≠ ${totalStr}`);
  if (divergencias.length) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${divergencias.join("; ")}.`);
  }

  // --- Leia-me -----------------------------------------------------------------------------------------------------
  const maiorAtraso = linhas.reduce((m, l) => Math.max(m, l.diasDeAtraso), 0);
  const avisos = [
    "Dívida = cobranças não pagas (em aberto, protestadas ou em jurídico) com vencimento ANTERIOR a hoje; vencer hoje ainda não é atraso.",
    "Cobranças renegociadas (negotiated) ficam de fora de propósito: a dívida passa para a cobrança nova, e listar as duas contaria o mesmo valor duas vezes.",
    "O valor inclui juros e multa (currentAmount do Conexa), como na tela do Conexa; 'Valor original' é sem acréscimos.",
    `Os dias de atraso são contados até ${dataBr(e.hoje)}: abrir o arquivo outro dia NÃO recalcula, e o valor também é o do momento da última sincronização.`,
  ];
  if (comContato) avisos.push("Esta planilha contém telefone e e-mail de clientes (dados pessoais): trate com o cuidado devido (LGPD) e não a encaminhe a quem não precisa.");
  const leiaMe = abaLeiaMe({
    titulo: "Exportação de inadimplentes — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: `${e.usuario.nome} (${e.usuario.email})`,
    filtros: descreverFiltrosInad(pedido.filtros),
    resultado: [
      ["Cobranças exportadas", linhas.length.toLocaleString("pt-BR")],
      ["Clientes", clientesDistintos.toLocaleString("pt-BR")],
      ["Valor em atraso (com juros e multa)", formatBRL(total)],
      ["Maior atraso", contagem(maiorAtraso, "dia", "dias")],
      ["Colunas do detalhe", colunas.map((c) => c.titulo).join(" · ")],
    ],
    frescor: e.frescor,
    avisos,
    conferencia: `OK. A soma do detalhe (${formatBRL(total)}) foi conferida contra o banco, contra cada aba e contra o arquivo lido de volta, antes de entregar.`,
  });

  return { abas: [leiaMe, detalhe.aba, ...abas], detalhe, total, clientes: clientesDistintos, titulosDasColunas: colunas.map((c) => c.titulo) };
}
