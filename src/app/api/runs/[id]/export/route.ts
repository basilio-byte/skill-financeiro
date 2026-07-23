import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { buildCategorizationXlsx } from "@/lib/categorization/export-xlsx";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const run = await prisma.revenueSyncRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Rodada não encontrada" }, { status: 404 });

  // Como as linhas são upsert por fatura (ADR-0013), este export reflete o
  // que essas linhas são AGORA (incluindo revisões/sincronizações feitas
  // depois desta rodada) — não um snapshot congelado do que ela calculou.
  //
  // Filtra por `dataCredito` dentro do período da RODADA, não por
  // `ultimaRodadaId` (bug encontrado em auditoria 2026-07-23): o auto-sync
  // roda a cada 15 min sempre reprocessando o MESMO período (dia 1 até
  // agora), e cada tick novo re-carimba `ultimaRodadaId` em TODAS as linhas
  // que toca — na prática só a rodada mais recente teria `ultimaRodadaId`
  // igual à sua própria, e o export de qualquer rodada mais antiga vinha
  // sempre vazio (só a linha de totais). Filtrar por período é o que o
  // comentário acima já dizia pretender.
  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { dataCredito: { gte: run.periodoInicio, lte: run.periodoFim } },
    orderBy: { crConexaId: "asc" },
  });

  const buffer = buildCategorizationXlsx(linhas);
  const nome = `Categorizacao_${run.periodoInicio.toISOString().slice(0, 10)}_${run.periodoFim
    .toISOString()
    .slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${nome}"`,
    },
  });
}
