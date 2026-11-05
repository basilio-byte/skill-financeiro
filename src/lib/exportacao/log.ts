import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Formato, UsuarioExport } from "./tipos";

/**
 * Rastro de exportações (ADR-0035). "Melhor esforço": gravar o log NUNCA pode derrubar nem atrasar um download —
 * se a tabela não existir (migration ainda não aplicada) ou o banco recusar, a exportação já feita é entregue do
 * mesmo jeito e o problema só vai para o log do servidor.
 */

export interface RegistroExportacao {
  usuario: UsuarioExport;
  conjunto: string;
  formato: Formato;
  filtros?: unknown;
  resumoFiltros?: string;
  linhas?: number;
  /** "1234.56" */
  total?: string | null;
  dadosPessoais?: boolean;
  resultado: "ok" | "erro" | "recusada" | "cancelada";
  erro?: string;
  duracaoMs?: number;
}

/** Recusa/erro/cancelamento repetido da mesma pessoa no mesmo conjunto dentro desta janela vira UMA linha só. */
const JANELA_DE_REPETICAO_MS = 30_000;

export async function registrarExportacao(r: RegistroExportacao): Promise<void> {
  try {
    const quem = `${r.usuario.nome} (${r.usuario.email})`;
    if (r.resultado !== "ok") {
      // Quem repete uma requisição que falha (um laço, um clique repetido) não pode encher a tabela: o que interessa ao
      // rastro é QUE houve a tentativa, não cada repetição dela.
      const repetida = await prisma.exportacaoLog.findFirst({
        where: { quem, conjunto: r.conjunto, resultado: r.resultado, quando: { gte: new Date(Date.now() - JANELA_DE_REPETICAO_MS) } },
        select: { id: true },
      });
      if (repetida) return;
    }
    await prisma.exportacaoLog.create({
      data: {
        quem,
        papel: r.usuario.papel,
        conjunto: r.conjunto,
        formato: r.formato,
        filtros: r.filtros === undefined ? Prisma.DbNull : (JSON.parse(JSON.stringify(r.filtros)) as Prisma.InputJsonValue),
        resumoFiltros: r.resumoFiltros?.slice(0, 4000) ?? null,
        linhas: r.linhas ?? 0,
        total: r.total ?? null,
        dadosPessoais: r.dadosPessoais ?? false,
        resultado: r.resultado,
        erro: r.erro?.slice(0, 1000) ?? null,
        duracaoMs: r.duracaoMs ?? null,
      },
    });
  } catch (err) {
    console.warn("[exportacao] não consegui gravar o log (a exportação em si não foi afetada):", err instanceof Error ? err.message : err);
  }
}

export interface LinhaDoHistorico {
  id: string;
  quando: Date;
  quem: string;
  conjunto: string;
  formato: string;
  linhas: number;
  total: string | null;
  dadosPessoais: boolean;
  resultado: string;
  resumoFiltros: string | null;
  erro: string | null;
}

/** As últimas exportações (para a tela, administrador). Tabela ausente → lista vazia, nunca erro de página. */
export async function ultimasExportacoes(n = 15): Promise<LinhaDoHistorico[]> {
  try {
    const rows = await prisma.exportacaoLog.findMany({ orderBy: { quando: "desc" }, take: n });
    return rows.map((r) => ({
      id: r.id,
      quando: r.quando,
      quem: r.quem,
      conjunto: r.conjunto,
      formato: r.formato,
      linhas: r.linhas,
      total: r.total?.toFixed(2) ?? null,
      dadosPessoais: r.dadosPessoais,
      resultado: r.resultado,
      resumoFiltros: r.resumoFiltros,
      erro: r.erro,
    }));
  } catch (err) {
    console.warn("[exportacao] histórico indisponível:", err instanceof Error ? err.message : err);
    return [];
  }
}
