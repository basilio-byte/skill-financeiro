/**
 * Núcleo PURO da inadimplência (ADR-0031) — sem Prisma, sem fetch, sem relógio
 * implícito. Tudo que decide "isto é dívida?" e "como filtrar" mora aqui para
 * ser testável com fixtures, no mesmo espírito de categorize-invoices.ts.
 */
import { money, type Money } from "@/lib/money";

/**
 * Status do Conexa que representam dívida real.
 *
 * ⚠ Medido na API em 2026-10-05 — não suposto:
 *  - NÃO existe "overdue": inadimplente é `unpaid` com vencimento no passado.
 *  - `generatedByNegotiation` são cobranças já PAGAS (todas vieram com "Pago em"),
 *    portanto não são dívida.
 *  - `negotiated` é a cobrança SUBSTITUÍDA pela renegociação (inclusive com
 *    vencimentos futuros). Listá-la dobraria a dívida — o dash comercial a tira
 *    dos totais pelo mesmo motivo. Fica de fora de propósito.
 *  - `protested` e `juridical` hoje têm zero registros, mas são dívida pesada e
 *    custam uma requisição cada; incluí-los evita um buraco silencioso no dia em
 *    que aparecerem.
 */
export const STATUS_DE_DIVIDA = ["unpaid", "protested", "juridical"] as const;
export type StatusDeDivida = (typeof STATUS_DE_DIVIDA)[number];

export const ROTULO_STATUS: Record<string, string> = {
  unpaid: "Em aberto",
  protested: "Protestada",
  juridical: "Jurídico",
};

/** O que a API devolve de uma cobrança — só os campos que usamos, todos opcionais. */
export interface CobrancaApi {
  chargeId?: number;
  companyId?: number;
  customerId?: number;
  status?: string;
  type?: string;
  amount?: number | string | null;
  currentAmount?: number | string | null;
  competenceDate?: string | null;
  dueDate?: string | null;
  updatedAt?: string | null;
}

export interface ClienteApi {
  customerId?: number;
  name?: string | null;
  tradeName?: string | null;
  cellNumber?: unknown;
  phones?: unknown;
  emailsFinancialMessages?: unknown;
  emailsMessage?: unknown;
}

export interface LinhaDeDivida {
  conexaId: number;
  companyConexaId: number | null;
  customerConexaId: number | null;
  status: string;
  tipo: string | null;
  valor: string;
  valorOriginal: string;
  vencimento: Date;
  competencia: Date | null;
  atualizadoNoConexa: Date | null;
}

/** "2024-03-15" ou ISO completo → meia-noite UTC do dia-calendário. Inválido → null. */
export function dataPura(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Rejeita 2026-02-31 e afins: Date.UTC normalizaria em silêncio para março.
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return d;
}

function valorOuNull(v: number | string | null | undefined): Money | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const m = money(typeof v === "number" ? String(v) : v);
    return m.isFinite() ? m : null;
  } catch {
    return null;
  }
}

/**
 * Inadimplente = status de dívida E vencimento ANTERIOR a hoje.
 * Vence hoje ainda não é atraso — o cliente tem o dia inteiro para pagar.
 *
 * `hoje` vem de fora (meia-noite UTC do dia no fuso do app, `keyToUtcDate`) em
 * vez de `new Date()` aqui dentro: é o que torna a fronteira testável.
 */
export function ehInadimplente(c: CobrancaApi, hoje: Date): boolean {
  if (!c.chargeId || !c.status) return false;
  if (!(STATUS_DE_DIVIDA as readonly string[]).includes(c.status)) return false;
  const venc = dataPura(c.dueDate);
  return venc !== null && venc.getTime() < hoje.getTime();
}

/**
 * Cobrança da API → linha do espelho, ou null se não é dívida ou se faltar o
 * que não pode faltar. Nunca inventa valor: sem `amount` nem `currentAmount`
 * legíveis a linha é descartada (e contada por quem chama) em vez de entrar com
 * zero — "dívida de R$ 0,00" esconderia um dado quebrado.
 */
export function mapearCobranca(c: CobrancaApi, hoje: Date): LinhaDeDivida | null {
  if (!ehInadimplente(c, hoje)) return null;
  const original = valorOuNull(c.amount);
  const atual = valorOuNull(c.currentAmount);
  const base = atual ?? original;
  if (!base) return null;
  return {
    conexaId: c.chargeId!,
    companyConexaId: c.companyId ?? null,
    customerConexaId: c.customerId ?? null,
    status: c.status!,
    tipo: c.type ?? null,
    valor: base.toDecimalPlaces(2).toFixed(2),
    valorOriginal: (original ?? base).toDecimalPlaces(2).toFixed(2),
    vencimento: dataPura(c.dueDate)!,
    competencia: dataPura(c.competenceDate),
    atualizadoNoConexa: c.updatedAt ? new Date(c.updatedAt) : null,
  };
}

/** Dias corridos de atraso. 0 se vence hoje ou no futuro. */
export function diasDeAtraso(vencimento: Date, hoje: Date): number {
  return Math.max(0, Math.floor((hoje.getTime() - vencimento.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Contato do cliente. O formato exato de `phones`/`emails*` não está confirmado
// (string, lista de strings ou lista de objetos) — extração tolerante, e a
// ausência é um valor legítimo (null), nunca um erro.
// ---------------------------------------------------------------------------

function primeiroTexto(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.split(/[;,]/)[0]?.trim();
    return t ? t : null;
  }
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = primeiroTexto(item);
      if (t) return t;
    }
    return null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["number", "phone", "email", "value", "address"]) {
      const t = primeiroTexto(o[k]);
      if (t) return t;
    }
  }
  return null;
}

export function contatoDoCliente(c: ClienteApi): { telefone: string | null; email: string | null } {
  return {
    telefone: primeiroTexto(c.cellNumber) ?? primeiroTexto(c.phones),
    email: primeiroTexto(c.emailsFinancialMessages) ?? primeiroTexto(c.emailsMessage),
  };
}

// ---------------------------------------------------------------------------
// Filtros da URL → consulta. O estado vive na URL (colável, sobrevive ao F5, o
// servidor filtra) — mesmo padrão do Radar do dash comercial.
// ---------------------------------------------------------------------------

export const ORDENS = ["valor", "vencimento"] as const;
export type Ordem = (typeof ORDENS)[number];
export type Direcao = "asc" | "desc";
/** "cliente" = uma linha por devedor (soma das cobranças); "cobranca" = uma por cobrança. */
export type Visao = "cliente" | "cobranca";

export interface FiltrosInadimplencia {
  /** Vencimento a partir de (inclusive). */
  de: Date | null;
  /** Vencimento até (inclusive). */
  ate: Date | null;
  q: string;
  status: string | null;
  unidade: string | null;
  ordem: Ordem;
  direcao: Direcao;
  visao: Visao;
  pagina: number;
}

export type ParamsBrutos = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/** Aceita só "yyyy-MM-dd" real; qualquer outra coisa vira "sem filtro". */
function dataDoFiltro(raw: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dataPura(raw) : null;
}

/**
 * Lê e SANEIA os parâmetros. Valor desconhecido nunca vira erro 500 nem filtro
 * estranho: cai no padrão (maior valor primeiro, tudo, página 1).
 */
export function lerFiltros(sp: ParamsBrutos): FiltrosInadimplencia {
  const ordemBruta = um(sp.ordem);
  const ordem: Ordem = (ORDENS as readonly string[]).includes(ordemBruta) ? (ordemBruta as Ordem) : "valor";
  const dirBruta = um(sp.dir);
  // Padrão por critério: valor do MAIOR para o menor; vencimento do mais ANTIGO.
  const direcao: Direcao = dirBruta === "asc" || dirBruta === "desc" ? dirBruta : ordem === "valor" ? "desc" : "asc";

  const status = um(sp.status);
  const pagina = Number.parseInt(um(sp.pagina), 10);

  let de = dataDoFiltro(um(sp.de));
  let ate = dataDoFiltro(um(sp.ate));
  // Intervalo invertido: troca em vez de devolver lista vazia sem explicação.
  if (de && ate && de.getTime() > ate.getTime()) [de, ate] = [ate, de];

  return {
    de,
    ate,
    q: um(sp.q).slice(0, 80),
    status: (STATUS_DE_DIVIDA as readonly string[]).includes(status) ? status : null,
    unidade: um(sp.unidade).slice(0, 60) || null,
    ordem,
    direcao,
    // Padrão por CLIENTE: "inadimplente" é quem deve, e a pergunta de quem cobra é
    // "quanto cada um me deve". A visão por cobrança é um clique.
    visao: um(sp.visao) === "cobranca" ? "cobranca" : "cliente",
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, 10_000) : 1,
  };
}

/** Faixas de atraso para os atalhos da tela — de/até de VENCIMENTO a partir de hoje. */
export const FAIXAS_DE_ATRASO = [
  { chave: "1-30", rotulo: "até 30 dias", minDias: 1, maxDias: 30 },
  { chave: "31-60", rotulo: "31 a 60", minDias: 31, maxDias: 60 },
  { chave: "61-90", rotulo: "61 a 90", minDias: 61, maxDias: 90 },
  { chave: "90+", rotulo: "mais de 90", minDias: 91, maxDias: null },
] as const;

const DIA = 86_400_000;

/** Intervalo de VENCIMENTO (yyyy-MM-dd) equivalente a uma faixa de atraso. */
export function intervaloDaFaixa(
  faixa: (typeof FAIXAS_DE_ATRASO)[number],
  hoje: Date,
): { de: string | null; ate: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  // maior atraso = vencimento mais antigo; menor atraso = vencimento mais recente.
  const ate = iso(new Date(hoje.getTime() - faixa.minDias * DIA));
  const de = faixa.maxDias === null ? null : iso(new Date(hoje.getTime() - faixa.maxDias * DIA));
  return { de, ate };
}
