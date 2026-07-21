import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { buildCategorizationXlsx } from "@/lib/categorization/export-xlsx";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const run = await prisma.revenueCategorizationRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Rodada não encontrada" }, { status: 404 });

  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { runId: id },
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
