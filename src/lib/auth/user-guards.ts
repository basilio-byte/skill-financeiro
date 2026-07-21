/**
 * Guardas de segurança de gestão de contas — LÓGICA PURA (sem banco, sem Next).
 *
 * Ficam separadas dos server actions de propósito: as decisões críticas ("posso
 * rebaixar este usuário?", "posso excluir?") são testáveis sem mockar Prisma nem
 * as APIs do Next. Os actions só juntam os dados (usuário atual, alvo, contagem de
 * admins ativos) e delegam a decisão para cá. Ver user-guards.test.ts.
 */

export type Role = "ADMIN" | "VIEWER";

export interface GuardTarget {
  role: Role;
  isActive: boolean;
}

export interface GuardDecision {
  ok: boolean;
  error?: string;
}

const ALLOW: GuardDecision = { ok: true };

/**
 * Pode aplicar esta edição (papel + situação) ao alvo?
 *
 * Regras (todas necessárias):
 *  - Auto-tranca: o próprio usuário não pode se rebaixar (ADMIN→VIEWER) nem se
 *    desativar — perderia o acesso no meio da ação.
 *  - Último admin ativo: não pode ser rebaixado nem desativado — a empresa ficaria
 *    sem nenhum administrador.
 */
export function guardUserEdit(params: {
  isSelf: boolean;
  target: GuardTarget;
  nextRole: Role;
  nextActive: boolean;
  activeAdminCount: number;
}): GuardDecision {
  const { isSelf, target, nextRole, nextActive, activeAdminCount } = params;
  const demoting = target.role === "ADMIN" && nextRole === "VIEWER";
  const deactivating = target.isActive && !nextActive;

  if (isSelf && (demoting || deactivating)) {
    return { ok: false, error: "Você não pode rebaixar nem desativar a própria conta." };
  }
  if ((demoting || deactivating) && target.role === "ADMIN" && target.isActive && activeAdminCount <= 1) {
    return { ok: false, error: "Não é possível: este é o último administrador ativo." };
  }
  return ALLOW;
}

/** Pode excluir o alvo? (não a si mesmo; não o último admin ativo). */
export function guardUserDelete(params: {
  isSelf: boolean;
  target: GuardTarget;
  activeAdminCount: number;
}): GuardDecision {
  const { isSelf, target, activeAdminCount } = params;
  if (isSelf) return { ok: false, error: "Você não pode excluir a própria conta." };
  if (target.role === "ADMIN" && target.isActive && activeAdminCount <= 1) {
    return { ok: false, error: "Não é possível excluir o último administrador ativo." };
  }
  return ALLOW;
}
