import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { EventoDeChamada } from "./protocolo";
import type { ContextoMcp } from "./tipos";

/**
 * RASTRO DE AUDITORIA DO MCP (ADR-0033) — uma linha por chamada de ferramenta.
 *
 * ⚠ Nunca lança: a auditoria não pode derrubar a chamada (o protocolo já isola, e
 * aqui também). Mas também não pode ser silenciosa — falha vai para o log.
 */

const LIMITE_ARGS = 4_000;
/** O estado ANTERIOR (uma linha de receita inteira) precisa caber: é o que permite desfazer. */
const LIMITE_DETALHE = 16_000;

/** JSON seguro para a coluna: tamanho limitado e sem Decimal/BigInt/Date quebrando. */
export function jsonLimitado(v: unknown, limite = LIMITE_ARGS): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined;
  const texto = JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return Number(x);
    if (x instanceof Date) return x.toISOString();
    if (x !== null && typeof x === "object" && "toFixed" in x && typeof (x as { toFixed: unknown }).toFixed === "function") {
      return String(x);
    }
    return x;
  });
  if (texto === undefined) return undefined;
  if (texto.length <= limite) return JSON.parse(texto) as Prisma.InputJsonValue;
  // Estourou: guarda o começo e avisa, em vez de perder em silêncio. O estado
  // ANTERIOR de uma exclusão cabe com folga; isto é só trava contra lixo enorme.
  return { _truncado: true, tamanhoOriginal: texto.length, inicio: texto.slice(0, limite) };
}

export function auditorDe(ctx: ContextoMcp) {
  return async (e: EventoDeChamada): Promise<void> => {
    try {
      await prisma.auditoriaMcp.create({
        data: {
          quem: ctx.quem,
          tokenId: ctx.tokenId,
          ferramenta: e.ferramenta,
          escrita: e.escrita,
          argumentos: jsonLimitado(e.argumentos),
          resultado: e.resultado,
          erro: e.erro ?? null,
          detalhe: jsonLimitado(e.detalhe, LIMITE_DETALHE),
          duracaoMs: e.duracaoMs,
        },
      });
    } catch (err) {
      console.error("[mcp] FALHA ao gravar auditoria (a chamada seguiu):", err);
    }
  };
}

/** Grava uma chamada RECUSADA antes de chegar ao protocolo (escrita com token de leitura). */
export async function auditarRecusa(ctx: ContextoMcp, ferramenta: string, motivo: string): Promise<void> {
  await auditorDe(ctx)({
    ferramenta,
    escrita: true,
    argumentos: {},
    resultado: "invalida",
    erro: `recusada: ${motivo}`,
    duracaoMs: 0,
  });
}
