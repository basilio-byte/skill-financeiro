"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRole } from "@/lib/auth/session";
import { formatBRL, money, roundMoney, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import { pushVinculoAgora } from "@/lib/clickup/push";
import { normalizarPadroes, bateAlgumPadrao } from "@/lib/clickup/filtro-padroes";
import { periodoCorrente } from "@/lib/clickup/periodo-corrente";

const CLICKUP_ADMIN_PATH = "/integracoes/clickup";

/**
 * Aceita tanto o ID cru quanto uma URL colada do ClickUp — pega sempre o
 * último segmento do caminho, que é onde o ClickUp coloca o ID (de tarefa
 * ou de lista) em qualquer formato de link que ele gera.
 */
function extrairIdDoTexto(valor: string): string {
  const limpo = valor.trim();
  if (!limpo) return "";
  try {
    const url = new URL(limpo);
    const segmentos = url.pathname.split("/").filter(Boolean);
    return segmentos[segmentos.length - 1] || limpo;
  } catch {
    return limpo;
  }
}

// IDs reais do ClickUp nunca têm "/" nem "." — exigir isso aqui (antes de
// persistir) rejeita de cara um valor colado errado, em vez de deixar o
// path traversal só ser barrado depois, no client HTTP (defesa em camadas —
// achado de revisão adversarial 2026-07-27).
const ID_CLICKUP_RE = /^[a-zA-Z0-9_-]+$/;

// -----------------------------------------------------------------------
// Prévia: mostra ANTES de salvar quais linhas reais (servicoOuPlano + soma)
// um padrão vai casar — nunca vincula por nome parecido às cegas (é
// dinheiro). Achado real (2026-07-27): cada tarefa do ClickUp representa um
// PRODUTO (ex. "Endereço Fiscal Batial"), somando todos os clientes que
// usam aquele produto, não um cliente só — ver comentário do model
// ClickUpVinculo em schema.prisma.
// -----------------------------------------------------------------------

export interface PreviewItem {
  servicoOuPlano: string;
  ocorrencias: number;
  totalHistorico: string;
  clientesDistintos: number;
}

export interface PreviewState {
  error?: string;
  itens?: PreviewItem[];
  totalMesCorrente?: string;
}

export async function previsualizarVinculoAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const categoria = String(formData.get("categoria") ?? "").trim();
  const padroes = normalizarPadroes(String(formData.get("padroes") ?? ""));
  if (!categoria) return { error: "Informe a categoria." };
  if (padroes.length === 0) return { error: "Informe ao menos um padrão (um por linha)." };

  // Busca só por categoria — o casamento por padrão é feito em JS logo
  // abaixo (bateAlgumPadrao), não numa query `contains` do Postgres, porque
  // precisa ignorar acento (ex. "Comércio"/"Comercio" convivem no
  // `servicoOuPlano` real da Conexa) e o Postgres só ignora maiúscula/
  // minúscula por padrão.
  const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
    where: { categoria },
    select: { servicoOuPlano: true, valorRecebidoCat: true, clienteConexaId: true, dataCredito: true },
  });
  const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, padroes));

  const grupos = new Map<string, { total: Money; ocorrencias: number; clientes: Set<number | null> }>();
  for (const l of linhasQueBatem) {
    const g = grupos.get(l.servicoOuPlano) ?? { total: ZERO, ocorrencias: 0, clientes: new Set<number | null>() };
    g.total = g.total.plus(money(l.valorRecebidoCat));
    g.ocorrencias += 1;
    g.clientes.add(l.clienteConexaId);
    grupos.set(l.servicoOuPlano, g);
  }
  const itens: PreviewItem[] = [...grupos.entries()]
    .map(([servicoOuPlano, g]) => ({
      servicoOuPlano,
      ocorrencias: g.ocorrencias,
      totalHistorico: toAmountString(roundMoney(g.total)),
      clientesDistintos: g.clientes.size,
    }))
    .sort((a, b) => Number(b.totalHistorico) - Number(a.totalHistorico));

  const { fromDate, toDateExclusive } = periodoCorrente();
  const totalMesCorrente = roundMoney(
    sum(
      linhasQueBatem
        .filter((l) => l.dataCredito && l.dataCredito >= fromDate && l.dataCredito < toDateExclusive)
        .map((l) => l.valorRecebidoCat),
    ),
  );

  return { itens, totalMesCorrente: toAmountString(totalMesCorrente) };
}

const vinculoSchema = z.object({
  categoria: z.string().trim().min(1, "Informe a categoria"),
  padroes: z
    .string()
    .transform((v) => normalizarPadroes(v))
    .refine((arr) => arr.length > 0, "Informe ao menos um padrão (um por linha)"),
  clickUpListId: z.string().trim().regex(ID_CLICKUP_RE, "ID da lista do ClickUp inválido — cole só o ID, sem barras ou pontos"),
  clickUpTaskId: z.string().trim().regex(ID_CLICKUP_RE, "ID da tarefa do ClickUp inválido — cole só o ID, sem barras ou pontos"),
});

export interface VinculoFormState {
  error?: string;
  ok?: string;
  aviso?: string;
}

/**
 * Cadastra o vínculo categoria + padrões (contra `servicoOuPlano`) -> tarefa
 * do ClickUp. A tela já mostrou a prévia real antes deste submit — aqui só
 * confirma de novo que existe histórico (defesa extra pra quem pular a
 * prévia), nunca por nome parecido inferido às cegas.
 */
export async function criarVinculoAction(_prev: VinculoFormState, formData: FormData): Promise<VinculoFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };

  const parsed = vinculoSchema.safeParse({
    categoria: formData.get("categoria"),
    padroes: formData.get("padroes"),
    clickUpListId: extrairIdDoTexto(String(formData.get("clickUpListId") ?? "")),
    clickUpTaskId: extrairIdDoTexto(String(formData.get("clickUpTaskId") ?? "")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  // Nenhuma linha bate com categoria+padrões — pode ser um padrão digitado
  // errado; não bloqueia (pode passar a bater no futuro), mas avisa, senão o
  // vínculo empurraria R$ 0,00 todo mês, indistinguível de um mês real sem
  // receita (achado de revisão adversarial 2026-07-27).
  const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
    where: { categoria: parsed.data.categoria },
    select: { servicoOuPlano: true },
  });
  const temHistorico = linhasDaCategoria.some((l) => bateAlgumPadrao(l.servicoOuPlano, parsed.data.padroes));

  try {
    await prisma.clickUpVinculo.create({
      data: {
        categoria: parsed.data.categoria,
        padroes: parsed.data.padroes,
        clickUpListId: parsed.data.clickUpListId,
        clickUpTaskId: parsed.data.clickUpTaskId,
        criadoPorId: auth.user.id,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "Esta tarefa do ClickUp já está ligada a outro vínculo." };
    }
    throw err;
  }

  revalidatePath(CLICKUP_ADMIN_PATH);
  return {
    ok: "Vínculo criado.",
    aviso: temHistorico
      ? undefined
      : `Nenhuma fatura já categorizada bate com "${parsed.data.categoria}" + os padrões informados — confira a grafia, senão este vínculo vai empurrar R$ 0,00 todo mês.`,
  };
}

export async function alternarVinculoAction(id: string, ativo: boolean): Promise<void> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) throw new Error(auth.error);
  await prisma.clickUpVinculo.update({ where: { id }, data: { ativo } });
  revalidatePath(CLICKUP_ADMIN_PATH);
}

/** Apaga o vínculo (e seu histórico de push, via cascade) — nunca mexe em RevenueCategorizedLine, só para de espelhar. */
export async function excluirVinculoAction(_prev: VinculoFormState, formData: FormData): Promise<VinculoFormState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Vínculo inválido." };

  await prisma.clickUpVinculo.delete({ where: { id } }).catch((err) => {
    if ((err as { code?: string })?.code === "P2025") return; // já não existia — some do mesmo jeito, sem erro
    throw err;
  });

  revalidatePath(CLICKUP_ADMIN_PATH);
  return { ok: "Vínculo removido." };
}

export interface PushAgoraState {
  error?: string;
  ok?: string;
}

/** Botão "Empurrar agora" — ignora a checagem de "valor mudou?", serve para testar um vínculo sem esperar a próxima rodada. */
export async function empurrarAgoraAction(_prev: PushAgoraState, formData: FormData): Promise<PushAgoraState> {
  const auth = await checkRole("ADMIN");
  if (!auth.ok) return { error: auth.error };
  const vinculoId = String(formData.get("vinculoId") ?? "");
  if (!vinculoId) return { error: "Vínculo inválido." };

  const resultado = await pushVinculoAgora(vinculoId);
  revalidatePath(CLICKUP_ADMIN_PATH);
  if (!resultado.sucesso) return { error: resultado.erro ?? "Falha ao empurrar." };
  return { ok: `Enviado: ${formatBRL(resultado.valorEnviado)}` };
}
