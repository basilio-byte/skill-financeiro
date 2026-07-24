"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { checkRole } from "@/lib/auth/session";
import { classificarConflito, type LinhaConflito } from "@/lib/categorization/conflitos";

export interface ConflitoActionState {
  error?: string;
  ok?: string;
}

function revalidarTelas() {
  revalidatePath("/conflitos");
  revalidatePath("/");
  revalidatePath("/revisar");
}

/**
 * Resolve automaticamente UM conflito, só quando a classificação (ver
 * conflitos.ts) é inequívoca — reclassifica com dado FRESCO de dentro da
 * própria transação Serializable (nunca confia na classificação já
 * renderizada na tela, que pode estar desatualizada se outra sincronização
 * rodou nesse meio-tempo) e recusa agir se o formato mudou para algo
 * ambíguo.
 */
export async function resolverAutomaticamenteAction(
  _prev: ConflitoActionState,
  formData: FormData,
): Promise<ConflitoActionState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const crConexaId = Number(formData.get("crConexaId"));
  if (!Number.isFinite(crConexaId)) return { error: "Fatura inválida." };

  try {
    const resultado = await prisma.$transaction(
      async (tx) => {
        const linhas = await tx.revenueCategorizedLine.findMany({
          where: { crConexaId },
          include: { revisadoPor: { select: { name: true, email: true } } },
        });

        const formatadas: LinhaConflito[] = linhas.map((l) => ({
          id: l.id,
          categoria: l.categoria,
          chaveLinha: l.chaveLinha,
          servicoOuPlano: l.servicoOuPlano,
          valorRecebidoCat: l.valorRecebidoCat.toString(),
          revisadoManualmente: l.revisadoManualmente,
          revisadoPorNome: l.revisadoPor?.name ?? l.revisadoPor?.email ?? null,
          revisadoEm: l.revisadoEm?.toISOString() ?? null,
          categoriaOriginal: l.categoriaOriginal,
          valorRecebidoCatOriginal: l.valorRecebidoCatOriginal?.toString() ?? null,
        }));

        const classificacao = classificarConflito(formatadas);

        if (classificacao.tipo === "ambiguo") {
          throw new Error(
            "Este caso não é mais resolvível automaticamente (formato mudou ou nunca foi um dos dois padrões conhecidos) — resolva excluindo a linha errada manualmente.",
          );
        }

        if (classificacao.tipo === "manual_superada") {
          await tx.revenueCategorizedLine.delete({ where: { id: classificacao.linhaParaExcluirId } });
          return `Linha manual redundante removida (uma regra real já categoriza esta fatura corretamente).`;
        }

        // duplicata_sem_categoria: excluir a automática PRIMEIRO (libera a
        // chave), só depois re-chavear a manual — na ordem inversa, o
        // @@unique([crConexaId, chaveLinha]) rejeitaria o update.
        await tx.revenueCategorizedLine.delete({ where: { id: classificacao.linhaParaExcluirId } });
        await tx.revenueCategorizedLine.update({
          where: { id: classificacao.linhaParaRechavearId },
          data: { chaveLinha: classificacao.novaChave },
        });
        return `Duplicata removida e a linha manual re-chaveada para "${classificacao.novaChave}" — não deve mais reaparecer nas próximas sincronizações.`;
      },
      { isolationLevel: "Serializable" },
    );

    revalidarTelas();
    return { ok: resultado };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2034") {
      return { error: "Conflito de concorrência (uma sincronização rodou ao mesmo tempo) — tente novamente." };
    }
    return { error: err instanceof Error ? err.message : "Falha ao resolver." };
  }
}

/**
 * Exclui UMA linha específica, escolhida manualmente pelo admin — para os
 * casos "ambíguos" que a resolução automática recusa tocar. Ação genérica e
 * irreversível (não há confirmação adicional aqui; a UI deve confirmar antes
 * de chamar) — usar com cuidado, sempre olhando o resumo da fatura antes.
 */
export async function excluirLinhaConflitoAction(
  _prev: ConflitoActionState,
  formData: FormData,
): Promise<ConflitoActionState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const lineId = String(formData.get("lineId") ?? "");
  if (!lineId) return { error: "Linha inválida." };

  try {
    await prisma.$transaction(
      async (tx) => {
        const linha = await tx.revenueCategorizedLine.findUnique({ where: { id: lineId } });
        if (!linha) throw new Error("Linha não encontrada (talvez já excluída).");
        await tx.revenueCategorizedLine.delete({ where: { id: lineId } });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (err) {
    if ((err as { code?: string })?.code === "P2034") {
      return { error: "Conflito de concorrência (uma sincronização rodou ao mesmo tempo) — tente novamente." };
    }
    return { error: err instanceof Error ? err.message : "Falha ao excluir." };
  }

  revalidarTelas();
  return { ok: "Linha excluída." };
}
