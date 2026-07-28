"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MetaGranularidade } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRole } from "@/lib/auth/session";
import { money, roundMoney, toAmountString } from "@/lib/money";
import { ANO_MES_RE, ANO_TRIMESTRE_RE } from "@/lib/metas/periodo";

export interface MetaFormState {
  error?: string;
  ok?: string;
}

/**
 * Valor vem de `<input type="number" step="0.01">`, então chega no formato
 * canônico com ponto ("25000.00") — nunca "R$ 25.000,00".
 *
 * Isso é deliberado: um parser "esperto" de pt-BR trataria "25.000" (o jeito
 * mais natural de escrever uma meta redonda à mão) como vinte e cinco reais,
 * porque o ponto vira separador decimal — silenciosamente, sem erro nenhum.
 * Input numérico elimina a classe inteira do problema.
 */
const metaSchema = z
  .object({
    escopoSlug: z.string().min(1, "Escolha o escopo"),
    granularidade: z.enum(["MES", "TRIMESTRE"], { message: "Escolha Mensal ou Trimestral" }),
    periodoChave: z.string().min(1, "Informe o período"),
    valor: z
      .string()
      .min(1, "Informe o valor da meta")
      .regex(/^\d+(\.\d{1,2})?$/, "Valor inválido — use apenas números (ex.: 25000.00)"),
    repetirAteFimDoAno: z.string().optional(),
  })
  .refine(
    (data) =>
      data.granularidade === "MES" ? ANO_MES_RE.test(data.periodoChave) : ANO_TRIMESTRE_RE.test(data.periodoChave),
    { message: "Período inválido (mês esperado AAAA-MM, trimestre esperado AAAA-Q#)", path: ["periodoChave"] },
  );

/** Períodos-átomo de `periodoChave` até o fim do MESMO ano (inclusive), na mesma granularidade. */
function periodosAteFimDoAno(granularidade: MetaGranularidade, periodoChave: string): string[] {
  if (granularidade === "TRIMESTRE") {
    const [ano, q] = periodoChave.split("-Q").map(Number);
    const out: string[] = [];
    for (let trimestre = q!; trimestre <= 4; trimestre++) out.push(`${ano}-Q${trimestre}`);
    return out;
  }
  const [ano, mes] = periodoChave.split("-").map(Number);
  const out: string[] = [];
  for (let m = mes!; m <= 12; m++) out.push(`${ano}-${String(m).padStart(2, "0")}`);
  return out;
}

export async function definirMetaAction(_prev: MetaFormState, formData: FormData): Promise<MetaFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  // O form manda Ano e (Mês OU Trimestre, conforme a granularidade escolhida)
  // em <select>s separados (não dá pra combinar no HTML sem JS) — remontados
  // aqui antes de validar contra o regex da granularidade.
  const granularidadeBruta = String(formData.get("granularidade") ?? "");
  const metaAno = formData.get("metaAno");
  const metaSubPeriodo = granularidadeBruta === "MES" ? formData.get("metaMes") : formData.get("metaTrimestre");
  const periodoChave = metaAno && metaSubPeriodo ? `${metaAno}-${metaSubPeriodo}` : "";

  const parsed = metaSchema.safeParse({
    escopoSlug: formData.get("escopoSlug"),
    granularidade: granularidadeBruta,
    periodoChave,
    valor: formData.get("valor"),
    repetirAteFimDoAno: formData.get("repetirAteFimDoAno") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const valor = roundMoney(money(parsed.data.valor));
  if (valor.isNegative()) return { error: "A meta não pode ser negativa." };

  const escopo = await prisma.metaEscopo.findUnique({ where: { slug: parsed.data.escopoSlug } });
  if (!escopo) return { error: "Escopo de meta não encontrado." };

  const { granularidade } = parsed.data;
  const periodos = parsed.data.repetirAteFimDoAno
    ? periodosAteFimDoAno(granularidade, parsed.data.periodoChave)
    : [parsed.data.periodoChave];
  const valorStr = toAmountString(valor);

  // Uma transação só: gravar a meta e registrar a alteração no log são um fato
  // só. Meta é o número contra o qual a equipe é avaliada — mudar de R$ 30.000
  // para R$ 20.000 no fim do período não pode ficar indistinguível de sempre
  // ter sido R$ 20.000 (financial-rigor #9).
  await prisma.$transaction(async (tx) => {
    for (const periodoChave of periodos) {
      const atual = await tx.metaPeriodo.findUnique({
        where: { escopoId_granularidade_periodoChave: { escopoId: escopo.id, granularidade, periodoChave } },
        select: { id: true, valor: true },
      });
      // Regravar o mesmo valor não é alteração — não polui o log.
      if (atual && atual.valor.toString() === valorStr) continue;

      const salvo = await tx.metaPeriodo.upsert({
        where: { escopoId_granularidade_periodoChave: { escopoId: escopo.id, granularidade, periodoChave } },
        update: { valor: valorStr, definidoPorId: auth.user.id },
        create: { escopoId: escopo.id, granularidade, periodoChave, valor: valorStr, definidoPorId: auth.user.id },
      });
      await tx.metaPeriodoEvent.create({
        data: {
          metaPeriodoId: salvo.id,
          valorAnterior: atual?.valor ?? null,
          valorNovo: valorStr,
          alteradoPorId: auth.user.id,
        },
      });
    }
  });

  revalidatePath("/metas");
  revalidatePath("/");
  const quantos = periodos.length;
  const unidade = granularidade === "MES" ? "meses" : "trimestres";
  return {
    ok:
      quantos === 1
        ? `Meta de ${escopo.nome} em ${periodos[0]} definida.`
        : `Meta de ${escopo.nome} definida para ${quantos} ${unidade} (${periodos[0]} até ${periodos[quantos - 1]}).`,
  };
}

/** Remove a meta de um período (volta ao estado "sem meta definida"). */
export async function removerMetaAction(_prev: MetaFormState, formData: FormData): Promise<MetaFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const id = String(formData.get("metaPeriodoId") ?? "");
  if (!id) return { error: "Meta inválida." };

  const meta = await prisma.metaPeriodo.findUnique({
    where: { id },
    include: { escopo: { select: { nome: true } } },
  });
  if (!meta) return { error: "Meta não encontrada." };

  // O log tem onDelete: Cascade para MetaPeriodo, então apagar a meta apaga o
  // histórico dela junto — aceitável porque remover é o oposto de definir, mas
  // por isso a UI trata remoção como ação explícita, nunca efeito colateral.
  await prisma.metaPeriodo.delete({ where: { id } });
  revalidatePath("/metas");
  revalidatePath("/");
  return { ok: `Meta de ${meta.escopo.nome} em ${meta.periodoChave} removida.` };
}
