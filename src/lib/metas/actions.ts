"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRole } from "@/lib/auth/session";
import { money, roundMoney, toAmountString } from "@/lib/money";
import { ANO_MES_RE } from "@/lib/metas/periodo";

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
const metaSchema = z.object({
  escopoSlug: z.string().min(1, "Escolha o escopo"),
  anoMes: z.string().regex(ANO_MES_RE, "Mês inválido (esperado AAAA-MM)"),
  valor: z
    .string()
    .min(1, "Informe o valor da meta")
    .regex(/^\d+(\.\d{1,2})?$/, "Valor inválido — use apenas números (ex.: 25000.00)"),
  repetirAteDezembro: z.string().optional(),
});

/** Meses de `anoMes` até dezembro do MESMO ano (inclusive). */
function mesesAteDezembro(anoMes: string): string[] {
  const [ano, mes] = anoMes.split("-").map(Number);
  const out: string[] = [];
  for (let m = mes!; m <= 12; m++) out.push(`${ano}-${String(m).padStart(2, "0")}`);
  return out;
}

export async function definirMetaAction(_prev: MetaFormState, formData: FormData): Promise<MetaFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const parsed = metaSchema.safeParse({
    escopoSlug: formData.get("escopoSlug"),
    anoMes: formData.get("anoMes"),
    valor: formData.get("valor"),
    repetirAteDezembro: formData.get("repetirAteDezembro") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const valor = roundMoney(money(parsed.data.valor));
  if (valor.isNegative()) return { error: "A meta não pode ser negativa." };

  const escopo = await prisma.metaEscopo.findUnique({ where: { slug: parsed.data.escopoSlug } });
  if (!escopo) return { error: "Escopo de meta não encontrado." };

  const meses = parsed.data.repetirAteDezembro ? mesesAteDezembro(parsed.data.anoMes) : [parsed.data.anoMes];
  const valorStr = toAmountString(valor);

  // Uma transação só: gravar a meta e registrar a alteração no log são um fato
  // só. Meta é o número contra o qual a equipe é avaliada — mudar de R$ 30.000
  // para R$ 20.000 no fim do mês não pode ficar indistinguível de sempre ter
  // sido R$ 20.000 (financial-rigor #9).
  await prisma.$transaction(async (tx) => {
    for (const anoMes of meses) {
      const atual = await tx.metaPeriodo.findUnique({
        where: { escopoId_anoMes: { escopoId: escopo.id, anoMes } },
        select: { id: true, valor: true },
      });
      // Regravar o mesmo valor não é alteração — não polui o log.
      if (atual && atual.valor.toString() === valorStr) continue;

      const salvo = await tx.metaPeriodo.upsert({
        where: { escopoId_anoMes: { escopoId: escopo.id, anoMes } },
        update: { valor: valorStr, definidoPorId: auth.user.id },
        create: { escopoId: escopo.id, anoMes, valor: valorStr, definidoPorId: auth.user.id },
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
  const quantos = meses.length;
  return {
    ok:
      quantos === 1
        ? `Meta de ${escopo.nome} em ${parsed.data.anoMes} definida.`
        : `Meta de ${escopo.nome} definida para ${quantos} meses (${meses[0]} até ${meses[quantos - 1]}).`,
  };
}

/** Remove a meta de um mês (volta ao estado "sem meta definida"). */
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
  return { ok: `Meta de ${meta.escopo.nome} em ${meta.anoMes} removida.` };
}
