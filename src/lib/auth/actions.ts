"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { createSession, destroyCurrentSession, requireUser } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Informe a senha"),
});

/**
 * Hash-isca (bcrypt de um valor aleatório, custo 12). Usado só para gastar o MESMO tempo de
 * verificação quando o e-mail não existe/está inativo — assim o login não revela por timing
 * quais e-mails são válidos. Não corresponde a nenhuma senha.
 */
const DUMMY_PASSWORD_HASH = "$2a$12$S4KLWkLRg/GIo8rXgpfDi.M3DOU6NcrTVuUip.5AR3xrGqCTe0nsy";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { email, password } = parsed.data;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? null;
  const userAgent = hdrs.get("user-agent")?.slice(0, 300) ?? null;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  const ok = Boolean(user && user.isActive && passwordOk);

  await prisma.loginEvent.create({
    data: {
      userId: user?.id ?? null,
      email,
      success: ok,
      reason: ok ? null : !user ? "usuário inexistente" : !user.isActive ? "usuário inativo" : "senha incorreta",
      ip,
      userAgent,
    },
  });

  if (!ok || !user) {
    return { error: "Credenciais inválidas." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  redirect("/runs");
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual"),
    newPassword: z.string().min(10, "A nova senha deve ter ao menos 10 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "A confirmação não corresponde à nova senha",
    path: ["confirmPassword"],
  });

export interface PasswordChangeState {
  error?: string;
  success?: boolean;
}

export async function changePasswordAction(
  _prev: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const user = await requireUser();
  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return { error: "Senha atual incorreta." };

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return { success: true };
}
