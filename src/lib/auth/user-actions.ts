"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getCurrentSessionId, requireRole, requireUser } from "@/lib/auth/session";
import { guardUserDelete, guardUserEdit } from "@/lib/auth/user-guards";

/**
 * GESTÃO DE CONTAS E ACESSOS.
 *
 * Permite criar usuários, definir papel (ADMIN/VIEWER), ativar/desativar,
 * resetar senha (admin) e cada um trocar a própria senha.
 *
 * Guardas de segurança (não são opcionais):
 *  - NUNCA deixar a Seahub sem nenhum admin ativo: bloqueia rebaixar, desativar
 *    ou excluir o ÚLTIMO admin ativo.
 *  - NÃO permitir auto-tranca: o próprio usuário não pode se rebaixar, se
 *    desativar nem se excluir (perderia o acesso no meio da ação).
 *  - Ao resetar a senha de alguém (ou desativar/excluir), as sessões daquele
 *    usuário são REVOGADAS — senão um cookie roubado continuaria valendo.
 */

export interface UserActionState {
  error?: string;
  ok?: string;
}

const MIN_PASSWORD = 8;

class GuardError extends Error {}

/**
 * Executa a validação de "último admin" e a mutação na MESMA transação Serializable.
 *
 * Por quê: ler a contagem de admins e depois gravar FORA de transação é um TOCTOU —
 * dois admins clicando "rebaixar/desativar/excluir" ao mesmo tempo podiam AMBOS passar na
 * guarda (cada um vê 2 admins) e zerar os administradores. Serializable faz o banco abortar
 * uma das duas (P2034); devolvemos "tente de novo".
 */
async function inSerializableGuard<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    return { ok: true, value };
  } catch (err) {
    if (err instanceof GuardError) return { ok: false, error: err.message };
    const code = (err as { code?: string })?.code;
    if (code === "P2034") return { ok: false, error: "Conflito de concorrência — tente novamente." };
    console.error("[user-actions] transação falhou:", err instanceof Error ? (err.stack ?? err.message) : err);
    return { ok: false, error: "Não foi possível concluir a operação." };
  }
}

const emailSchema = z
  .string()
  .email("E-mail inválido")
  .transform((v) => v.trim().toLowerCase());

const nameSchema = z.string().trim().min(2, "Informe o nome (mín. 2 caracteres)").max(120);

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD, `A senha deve ter ao menos ${MIN_PASSWORD} caracteres`)
  .max(200, "Senha longa demais");

const roleSchema = z.enum(["ADMIN", "VIEWER"]);

/** Revoga TODAS as sessões de um usuário (força novo login). */
async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Criar usuário (ADMIN)
// ---------------------------------------------------------------------------
export async function createUserAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  await requireRole("ADMIN");
  const parsed = z
    .object({ name: nameSchema, email: emailSchema, role: roleSchema, password: passwordSchema })
    .safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      password: formData.get("password"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { name, email, role, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "Já existe um usuário com este e-mail." };

  await prisma.user.create({
    data: { name, email, role, passwordHash: await hashPassword(password), isActive: true },
  });
  revalidatePath("/contas");
  return { ok: `Usuário ${email} criado.` };
}

// ---------------------------------------------------------------------------
// Editar usuário: nome, papel, ativo (ADMIN)
// ---------------------------------------------------------------------------
export async function updateUserAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({
      userId: z.string().min(1),
      name: nameSchema,
      role: roleSchema,
      isActive: z.union([z.literal("true"), z.literal("false")]).transform((v) => v === "true"),
    })
    .safeParse({
      userId: formData.get("userId"),
      name: formData.get("name"),
      role: formData.get("role"),
      isActive: formData.get("isActive"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { userId, name, role, isActive } = parsed.data;
  const isSelf = userId === admin.id;

  const result = await inSerializableGuard(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new GuardError("Usuário não encontrado.");
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
    const decision = guardUserEdit({
      isSelf,
      target: { role: target.role, isActive: target.isActive },
      nextRole: role,
      nextActive: isActive,
      activeAdminCount,
    });
    if (!decision.ok) throw new GuardError(decision.error ?? "Operação bloqueada.");
    await tx.user.update({ where: { id: userId }, data: { name, role, isActive } });
    return { email: target.email, deactivated: target.isActive && !isActive };
  });
  if (!result.ok) return { error: result.error };

  if (result.value.deactivated) await revokeUserSessions(userId);
  revalidatePath("/contas");
  return { ok: `Usuário ${result.value.email} atualizado.` };
}

// ---------------------------------------------------------------------------
// Resetar senha de um usuário (ADMIN)
// ---------------------------------------------------------------------------
export async function resetPasswordAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  await requireRole("ADMIN");
  const parsed = z
    .object({ userId: z.string().min(1), password: passwordSchema })
    .safeParse({ userId: formData.get("userId"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { userId, password } = parsed.data;
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "Usuário não encontrado." };

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await revokeUserSessions(userId);
  revalidatePath("/contas");
  return { ok: `Senha de ${target.email} redefinida. As sessões dele foram encerradas.` };
}

// ---------------------------------------------------------------------------
// Excluir usuário (ADMIN)
// ---------------------------------------------------------------------------
export async function deleteUserAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Usuário inválido." };

  const result = await inSerializableGuard(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new GuardError("Usuário não encontrado.");
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
    const decision = guardUserDelete({
      isSelf: target.id === admin.id,
      target: { role: target.role, isActive: target.isActive },
      activeAdminCount,
    });
    if (!decision.ok) throw new GuardError(decision.error ?? "Operação bloqueada.");
    // Sessões caem por cascade; LoginEvent vira userId null (auditoria preservada).
    await tx.user.delete({ where: { id: userId } });
    return target.email;
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/contas");
  return { ok: `Usuário ${result.value} excluído.` };
}

// ---------------------------------------------------------------------------
// Trocar a PRÓPRIA senha (qualquer usuário autenticado)
// ---------------------------------------------------------------------------
export async function changeMyPasswordAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      current: z.string().min(1, "Informe a senha atual"),
      next: passwordSchema,
      confirm: z.string().min(1),
    })
    .safeParse({
      current: formData.get("current"),
      next: formData.get("next"),
      confirm: formData.get("confirm"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { current, next, confirm } = parsed.data;
  if (next !== confirm) return { error: "A confirmação não confere com a nova senha." };
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "Senha atual incorreta." };
  if (await verifyPassword(next, user.passwordHash)) {
    return { error: "A nova senha deve ser diferente da atual." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  const currentSid = await getCurrentSessionId();
  await prisma.session.deleteMany({
    where: { userId: user.id, ...(currentSid ? { id: { not: currentSid } } : {}) },
  });
  revalidatePath("/minha-conta");
  return { ok: "Senha alterada. As outras sessões foram encerradas." };
}
