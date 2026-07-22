import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { startCategorizationRun } from "@/lib/categorization/run";

const bodySchema = z.object({
  periodoInicio: z.string(),
  periodoFim: z.string(),
});

/** Disparo programático de uma rodada (mesma lógica do form em /runs). */
export async function POST(req: Request) {
  // ADMIN, igual ao form: sincronizar não é leitura — reescreve linhas já
  // gravadas (upsert por fatura, ADR-0013). Aqui usamos getSessionUser direto,
  // e não requireUser/requireRole: numa rota de API o certo é responder
  // 401/403 em JSON, não redirecionar o cliente para uma página HTML.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem disparar sincronizações." }, { status: 403 });
  }
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
