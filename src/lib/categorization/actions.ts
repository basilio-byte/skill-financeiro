"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth/session";
import { startCategorizationRun } from "@/lib/categorization/run";
import { money, roundMoney, toAmountString } from "@/lib/money";

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

class LinhaNaoEncontradaError extends Error {}

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

  // Serializable (mesmo padrão de `inSerializableGuard` em auth/user-actions.ts
  // e do guard de `startCategorizationRun` em run.ts): uma sincronização
  // automática pode estar rodando `persistLinhasCategorizadas` (também
  // Serializable) neste exato momento, para a MESMA linha — sem os dois lados
  // serializáveis, o Postgres não detecta o conflito, e essa revisão manual
  // podia ser silenciosamente sobrescrita segundos depois de salva (achado
  // por verificação adversarial). Em conflito real (P2034), pedimos pro admin
  // tentar de novo — nunca aplicamos a revisão "meio feita".
  let ultimaRodadaId: string;
  try {
    ultimaRodadaId = await prisma.$transaction(
      async (tx) => {
        const linha = await tx.revenueCategorizedLine.findUnique({ where: { id: parsed.data.lineId } });
        if (!linha) throw new LinhaNaoEncontradaError();

        // Desde o modelo de upsert por fatura (ADR-0013), uma linha não pertence a
        // UMA rodada só — não existe mais "o resumo da rodada dona da linha" para
        // recalcular. Cada RevenueSyncRun fica congelada como estava no momento em
        // que rodou; os números ao vivo (já com esta revisão) vêm do Panorama e de
        // /revisar, que consultam as linhas atuais direto.
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

        return linha.ultimaRodadaId;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (err) {
    if (err instanceof LinhaNaoEncontradaError) return { error: "Linha não encontrada." };
    if ((err as { code?: string })?.code === "P2034") {
      return { error: "Conflito de concorrência (uma sincronização estava rodando ao mesmo tempo) — tente novamente." };
    }
    throw err;
  }

  revalidatePath(`/runs/${ultimaRodadaId}`);
  revalidatePath("/runs");
  revalidatePath("/revisar");
  revalidatePath("/");
  revalidatePath("/categorias");
  return { ok: "Linha atualizada." };
}
