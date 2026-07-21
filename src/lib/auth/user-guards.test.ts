import { describe, expect, it } from "vitest";
import { guardUserDelete, guardUserEdit } from "@/lib/auth/user-guards";

/**
 * As guardas existem para uma coisa: NUNCA deixar a Seahub sem acesso.
 * Dois modos de perder acesso: rebaixar/desativar/excluir o último admin, ou o
 * próprio admin se trancar fora. Ambos são testados aqui como lógica pura.
 */

const admin = { role: "ADMIN" as const, isActive: true };
const viewer = { role: "VIEWER" as const, isActive: true };

describe("guardUserEdit — rebaixar/desativar", () => {
  it("bloqueia rebaixar o ÚLTIMO admin ativo", () => {
    const d = guardUserEdit({ isSelf: false, target: admin, nextRole: "VIEWER", nextActive: true, activeAdminCount: 1 });
    expect(d.ok).toBe(false);
  });

  it("permite rebaixar um admin quando há OUTROS admins ativos", () => {
    const d = guardUserEdit({ isSelf: false, target: admin, nextRole: "VIEWER", nextActive: true, activeAdminCount: 2 });
    expect(d.ok).toBe(true);
  });

  it("bloqueia desativar o último admin ativo", () => {
    const d = guardUserEdit({ isSelf: false, target: admin, nextRole: "ADMIN", nextActive: false, activeAdminCount: 1 });
    expect(d.ok).toBe(false);
  });

  it("bloqueia o admin de se REBAIXAR (auto-tranca), mesmo havendo outros admins", () => {
    const d = guardUserEdit({ isSelf: true, target: admin, nextRole: "VIEWER", nextActive: true, activeAdminCount: 5 });
    expect(d.ok).toBe(false);
  });

  it("bloqueia o admin de se DESATIVAR (auto-tranca), mesmo havendo outros admins", () => {
    const d = guardUserEdit({ isSelf: true, target: admin, nextRole: "ADMIN", nextActive: false, activeAdminCount: 5 });
    expect(d.ok).toBe(false);
  });

  it("permite editar só o nome do próprio admin (sem rebaixar nem desativar)", () => {
    const d = guardUserEdit({ isSelf: true, target: admin, nextRole: "ADMIN", nextActive: true, activeAdminCount: 1 });
    expect(d.ok).toBe(true);
  });

  it("permite PROMOVER um viewer a admin", () => {
    const d = guardUserEdit({ isSelf: false, target: viewer, nextRole: "ADMIN", nextActive: true, activeAdminCount: 1 });
    expect(d.ok).toBe(true);
  });

  it("desativar um viewer nunca é bloqueado pela regra de último admin", () => {
    const d = guardUserEdit({ isSelf: false, target: viewer, nextRole: "VIEWER", nextActive: false, activeAdminCount: 1 });
    expect(d.ok).toBe(true);
  });

  it("reativar um admin inativo não é rebaixamento nem desativação", () => {
    const d = guardUserEdit({
      isSelf: false,
      target: { role: "ADMIN", isActive: false },
      nextRole: "ADMIN",
      nextActive: true,
      activeAdminCount: 1,
    });
    expect(d.ok).toBe(true);
  });
});

describe("guardUserDelete", () => {
  it("bloqueia excluir a própria conta", () => {
    expect(guardUserDelete({ isSelf: true, target: admin, activeAdminCount: 5 }).ok).toBe(false);
  });

  it("bloqueia excluir o último admin ativo", () => {
    expect(guardUserDelete({ isSelf: false, target: admin, activeAdminCount: 1 }).ok).toBe(false);
  });

  it("permite excluir um admin quando há outros admins ativos", () => {
    expect(guardUserDelete({ isSelf: false, target: admin, activeAdminCount: 2 }).ok).toBe(true);
  });

  it("permite excluir um viewer", () => {
    expect(guardUserDelete({ isSelf: false, target: viewer, activeAdminCount: 1 }).ok).toBe(true);
  });
});
