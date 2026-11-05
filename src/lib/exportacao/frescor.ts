import "server-only";
import { prisma } from "@/lib/db";
import { diagnosticarReceita } from "@/lib/mcp/diagnostico";
import { fraseDeFrescor, situacaoEmAlerta } from "./frescor-texto";

/**
 * A atualidade dos dados de receita (ADR-0035), para a aba Leia-me e para a tela de exportação.
 *
 * Usa o MESMO diagnóstico do MCP (`diagnosticarReceita`, o que `estado_do_sistema` mostra): "a receita de outubro é X"
 * sem dizer que a sincronização está parada é um erro. Só LEITURA — não toca em nada que a sincronização escreve.
 */

export interface Frescor {
  /** Frase pronta. */
  texto: string;
  /** true quando algo está errado ou defasado (parada, sem histórico, só importação manual). */
  alerta: boolean;
  situacao: string;
  ultimaConcluidaEm: Date | null;
}

const SELECT_RODADA = { status: true, origem: true, erro: true, iniciadoEm: true, concluidoEm: true, periodoInicio: true, periodoFim: true } as const;

export async function frescorDaReceita(agora: Date): Promise<Frescor> {
  const [recentes, ultimaDone] = await Promise.all([
    prisma.revenueSyncRun.findMany({ orderBy: { iniciadoEm: "desc" }, take: 40, select: SELECT_RODADA }),
    // A última CONCLUÍDA à parte: com a receita parada, a janela das mais recentes é toda de falhas.
    prisma.revenueSyncRun.findFirst({ where: { status: "DONE" }, orderBy: { iniciadoEm: "desc" }, select: SELECT_RODADA }),
  ]);
  const falhas = await prisma.revenueSyncRun.count({
    where: { status: "FAILED", ...(ultimaDone ? { iniciadoEm: { gt: ultimaDone.iniciadoEm } } : {}) },
  });
  const juntas = ultimaDone && !recentes.some((r) => r.iniciadoEm.getTime() === ultimaDone.iniciadoEm.getTime()) ? [...recentes, ultimaDone] : recentes;
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const diag = diagnosticarReceita(
    juntas.map((r) => ({ ...r, periodo: `${iso(r.periodoInicio)}..${iso(r.periodoFim)}` })),
    agora,
    falhas,
  );

  const concluidaEm = ultimaDone ? (ultimaDone.concluidoEm ?? ultimaDone.iniciadoEm) : null;
  return {
    texto: fraseDeFrescor(diag, concluidaEm),
    alerta: situacaoEmAlerta(diag.situacao),
    situacao: diag.situacao,
    ultimaConcluidaEm: concluidaEm,
  };
}
