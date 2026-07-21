"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { startCategorizationRun } from "@/lib/categorization/run";

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
