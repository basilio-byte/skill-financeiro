"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth/session";
import { startCategorizationRun } from "@/lib/categorization/run";
import { ZERO, money, roundMoney, sum, toAmountString } from "@/lib/money";

const periodoSchema = z.object({
  periodoInicio: z.string().min(1, "Informe a data início"),
  periodoFim: z.string().min(1, "Informe a data fim"),
});

export interface RunFormState {
  error?: string;
}

export async function triggerRunAction(_prev: RunFormState, formData: FormData): Promise<RunFormState> {
  const user = await requireUser();
  const parsed = periodoSchema.safeParse({
    periodoInicio: formData.get("periodoInicio"),
    periodoFim: formData.get("periodoFim"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const inicio = new Date(`${parsed.data.periodoInicio}T00:00:00Z`);
  const fim = new Date(`${parsed.data.periodoFim}T00:00:00Z`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    return { error: "Datas inválidas." };
  }
  if (inicio > fim) {
    return { error: "A data início não pode ser depois da data fim." };
  }

  let runId: string;
  try {
    runId = await startCategorizationRun({ periodoInicio: inicio, periodoFim: fim, executadoPorId: user.id });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao rodar a categorização." };
  }

  revalidatePath("/runs");
  redirect(`/runs/${runId}`);
}

const ruleSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do serviço/plano"),
  categoria: z.string().trim().min(1, "Informe a categoria"),
});

function normalizeRuleName(nome: string): string {
  return nome.trim().replace(/\s+/g, " ");
}

export async function createCategoryRuleAction(formData: FormData): Promise<void> {
  await requireUser();
  const parsed = ruleSchema.parse({ nome: formData.get("nome"), categoria: formData.get("categoria") });
  const nome = normalizeRuleName(parsed.nome);
  await prisma.revenueCategoryRule.upsert({
    where: { nome },
    update: { categoria: parsed.categoria, ativo: true },
    create: { nome, categoria: parsed.categoria },
  });
  revalidatePath("/categorias");
}

export async function updateCategoryRuleAction(id: string, formData: FormData): Promise<void> {
  await requireUser();
  const parsed = ruleSchema.parse({ nome: formData.get("nome"), categoria: formData.get("categoria") });
  await prisma.revenueCategoryRule.update({
    where: { id },
    data: { nome: normalizeRuleName(parsed.nome), categoria: parsed.categoria },
  });
  revalidatePath("/categorias");
}

export async function toggleCategoryRuleAction(id: string, ativo: boolean): Promise<void> {
  await requireUser();
  await prisma.revenueCategoryRule.update({ where: { id }, data: { ativo } });
  revalidatePath("/categorias");
}

// ---------------------------------------------------------------------------
// Revisão manual de uma linha categorizada ("Faturas para revisar").
//
// Regra permanente do projeto (ver docs/context/financial-rigor.md): tudo
// segue a skill categoriza-receita à risca; a ÚNICA exceção é dado revisado
// manualmente aqui — e mesmo essa exceção fica rastreada (quem, quando, e o
// valor ORIGINAL calculado pela skill, nunca sobrescrito em revisões seguintes).
// ---------------------------------------------------------------------------

const lineEditSchema = z.object({
  lineId: z.string().min(1),
  categoria: z.string().trim().min(1, "Informe a categoria"),
  valor: z.string().min(1, "Informe o valor"),
});

export interface LineEditState {
  error?: string;
  ok?: string;
}

export async function updateCategorizedLineAction(_prev: LineEditState, formData: FormData): Promise<LineEditState> {
  const admin = await requireRole("ADMIN");
  const parsed = lineEditSchema.safeParse({
    lineId: formData.get("lineId"),
    categoria: formData.get("categoria"),
    valor: formData.get("valor"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const novoValor = roundMoney(money(parsed.data.valor));
  if (Number.isNaN(novoValor.toNumber())) return { error: "Valor inválido." };
  if (novoValor.isNegative()) return { error: "O valor não pode ser negativo." };

  const linha = await prisma.revenueCategorizedLine.findUnique({ where: { id: parsed.data.lineId } });
  if (!linha) return { error: "Linha não encontrada." };

  await prisma.$transaction(async (tx) => {
    await tx.revenueCategorizedLine.update({
      where: { id: linha.id },
      data: {
        categoria: parsed.data.categoria,
        valorRecebidoCat: toAmountString(novoValor),
        revisadoManualmente: true,
        revisadoPorId: admin.id,
        revisadoEm: new Date(),
        // Snapshot só na PRIMEIRA revisão — preserva o que a skill calculou originalmente,
        // mesmo que a linha seja revisada de novo mais tarde.
        ...(linha.revisadoManualmente
          ? {}
          : { categoriaOriginal: linha.categoria, valorRecebidoCatOriginal: linha.valorRecebidoCat }),
      },
    });

    // Recalcula os agregados da rodada (resumoPorCategoria/totalRecebido) a partir de
    // TODAS as linhas — agora parcialmente revisadas — para que Panorama e o resumo
    // da própria rodada nunca fiquem dessincronizados de uma revisão manual.
    const todasLinhas = await tx.revenueCategorizedLine.findMany({ where: { runId: linha.runId } });
    const porCategoria = new Map<string, ReturnType<typeof money>>();
    for (const l of todasLinhas) {
      const atual = porCategoria.get(l.categoria) ?? ZERO;
      porCategoria.set(l.categoria, atual.plus(money(l.valorRecebidoCat.toString())));
    }
    const resumo = [...porCategoria.entries()]
      .map(([categoria, total]) => ({ categoria, total: toAmountString(roundMoney(total)) }))
      .sort((a, b) => Number(b.total) - Number(a.total));
    const totalRecebido = toAmountString(roundMoney(sum(todasLinhas.map((l) => l.valorRecebidoCat.toString()))));

    await tx.revenueCategorizationRun.update({
      where: { id: linha.runId },
      data: { resumoPorCategoria: resumo as unknown as Prisma.InputJsonValue, totalRecebido },
    });
  });

  revalidatePath(`/runs/${linha.runId}`);
  revalidatePath("/runs");
  revalidatePath("/");
  revalidatePath("/categorias");
  return { ok: "Linha atualizada." };
}
