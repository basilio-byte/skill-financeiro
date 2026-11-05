import type { Prisma } from "@prisma/client";
import type { LinhaReceita } from "./colunas-receita";
import { paraParede } from "./planilha";

/**
 * Do banco para `LinhaReceita` (ADR-0035) — PURO (só tipos do Prisma), testável sem banco. Separado de `receita.ts`
 * (que é `server-only`) justamente para poder ser testado.
 */

/** O que a consulta devolve — todos os campos fora da base são opcionais (só vêm os que as colunas escolhidas pedem). */
export interface RowBruto {
  id?: string;
  crConexaId: number;
  chaveLinha?: string;
  unidade?: string | null;
  faturamento?: string | null;
  clienteConexaId?: number | null;
  cpfCnpj?: string | null;
  razaoSocial?: string | null;
  planoContratado?: string | null;
  categoria: string;
  servicoOuPlano?: string;
  proporcionado: string;
  tipo?: string | null;
  status?: string | null;
  parcela?: string | null;
  valorRecebidoCat: Prisma.Decimal;
  valorRecebidoTotal?: Prisma.Decimal;
  valorBruto?: Prisma.Decimal | null;
  valorDesconto?: Prisma.Decimal | null;
  vencimento?: Date | null;
  quitacao?: Date | null;
  competencia?: Date | null;
  emissao?: Date | null;
  dataCredito?: Date | null;
  mesCredito: string;
  conta?: string | null;
  observacoes?: string | null;
  tags?: string | null;
  ajusteArredondamento?: Prisma.Decimal | null;
  revisadoManualmente: boolean;
  revisadoEm?: Date | null;
  categoriaOriginal?: string | null;
  valorRecebidoCatOriginal?: Prisma.Decimal | null;
  atualizadoEm?: Date;
  itensDetalhe?: Prisma.JsonValue | null;
  revisadoPor?: { name: string } | null;
}

const dec = (v: Prisma.Decimal | null | undefined): string | null => (v === null || v === undefined ? null : v.toFixed(2));

/** Linha do banco → `LinhaReceita`. Campo que não foi lido fica neutro (nenhuma coluna escolhida o usa). */
export function paraLinhaReceita(r: RowBruto): LinhaReceita {
  return {
    id: r.id ?? "",
    crConexaId: r.crConexaId,
    chaveLinha: r.chaveLinha ?? "",
    unidade: r.unidade ?? null,
    faturamento: r.faturamento ?? null,
    clienteConexaId: r.clienteConexaId ?? null,
    cpfCnpj: r.cpfCnpj ?? null,
    razaoSocial: r.razaoSocial ?? null,
    planoContratado: r.planoContratado ?? null,
    categoria: r.categoria,
    servicoOuPlano: r.servicoOuPlano ?? "",
    proporcionado: r.proporcionado,
    tipo: r.tipo ?? null,
    status: r.status ?? null,
    parcela: r.parcela ?? null,
    valorRecebidoCat: r.valorRecebidoCat.toFixed(2),
    valorRecebidoTotal: dec(r.valorRecebidoTotal) ?? "0.00",
    valorBruto: dec(r.valorBruto),
    valorDesconto: dec(r.valorDesconto),
    vencimento: r.vencimento ?? null,
    quitacao: r.quitacao ?? null,
    competencia: r.competencia ?? null,
    emissao: r.emissao ?? null,
    dataCredito: r.dataCredito ?? null,
    mesCredito: r.mesCredito,
    conta: r.conta ?? null,
    observacoes: r.observacoes ?? null,
    tags: r.tags ?? null,
    ajusteArredondamento: dec(r.ajusteArredondamento),
    revisadoManualmente: r.revisadoManualmente,
    revisadoPorNome: r.revisadoPor?.name ?? null,
    revisadoEm: r.revisadoEm ? paraParede(r.revisadoEm) : null,
    categoriaOriginal: r.categoriaOriginal ?? null,
    valorRecebidoCatOriginal: dec(r.valorRecebidoCatOriginal),
    atualizadoEm: r.atualizadoEm ? paraParede(r.atualizadoEm) : new Date(0),
    itensDetalhe: r.itensDetalhe ?? null,
  };
}

/**
 * Os campos pedidos → a seleção do Prisma. `revisadoPorNome` vem da relação; os demais têm o MESMO nome da coluna
 * (um teste confere cada nome contra o modelo, para um erro de digitação não virar falha só em produção).
 */
export function selecao(campos: ReadonlySet<string>): Prisma.RevenueCategorizedLineSelect {
  const s: Record<string, unknown> = {};
  for (const c of campos) {
    if (c === "revisadoPorNome") s.revisadoPor = { select: { name: true } };
    else s[c] = true;
  }
  return s as Prisma.RevenueCategorizedLineSelect;
}
