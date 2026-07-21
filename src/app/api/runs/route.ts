import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { startCategorizationRun } from "@/lib/categorization/run";

const bodySchema = z.object({
  periodoInicio: z.string(),
  periodoFim: z.string(),
});

/** Disparo programático de uma rodada (mesma lógica do form em /runs). */
export async function POST(req: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido — esperado { periodoInicio, periodoFim } (YYYY-MM-DD)" }, { status: 400 });
  }

  const periodoInicio = new Date(`${parsed.data.periodoInicio}T00:00:00Z`);
  const periodoFim = new Date(`${parsed.data.periodoFim}T00:00:00Z`);
  if (Number.isNaN(periodoInicio.getTime()) || Number.isNaN(periodoFim.getTime())) {
    return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
  }

  try {
    const runId = await startCategorizationRun({ periodoInicio, periodoFim, executadoPorId: user.id });
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Falha ao rodar" }, { status: 502 });
  }
}
