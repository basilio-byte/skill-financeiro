import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { User, UserRole } from "@prisma/client";

const COOKIE_NAME = "skillfin_session";
const SESSION_TTL_DAYS = 7;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

/**
 * Cria uma sessão server-side (revogável) e grava o cookie assinado (JWT).
 * O JWT carrega apenas ids; a validade autoritativa está na tabela Session.
 */
export async function createSession(userId: string): Promise<void> {
  const hdrs = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      userAgent: hdrs.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(hdrs),
    },
  });

  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Encerra a sessão atual (revoga no banco e limpa o cookie). */
export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey());
      const sid = payload.sid as string | undefined;
      if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    } catch {
      /* cookie inválido: apenas limpa */
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

/** Usuário autenticado atual, ou null. Valida assinatura + sessão no banco + expiração. */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const sid = payload.sid as string | undefined;
    const userId = payload.sub;
    if (!sid || !userId) return null;
    const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.userId !== userId) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.deleteMany({ where: { id: sid } });
      return null;
    }
    if (!session.user.isActive) return null;
    return session.user;
  } catch {
    return null;
  }
}

/**
 * Id da sessão atual (o `sid` dentro do JWT), ou null.
 *
 * Usado para revogar as OUTRAS sessões ao trocar a própria senha sem deslogar
 * quem está fazendo a troca. Só lê o cookie/assinatura — não vai ao banco.
 */
export async function getCurrentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return (payload.sid as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Exige usuário autenticado; redireciona para /login se não houver. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige um papel específico (ex.: ADMIN). Só para PÁGINAS — ver checkRole abaixo. */
export async function requireRole(role: UserRole): Promise<User> {
  const user = await requireUser();
  if (user.role !== role) redirect("/");
  return user;
}

/**
 * Mesma checagem de papel, mas para uso DENTRO de Server Actions.
 *
 * `requireRole` foi escrito para páginas, onde mandar o usuário para outra tela
 * é a resposta certa. Dentro de uma action isso vira um bug de usabilidade:
 * `redirect()` lança `NEXT_REDIRECT`, a action NUNCA retorna o seu estado, e o
 * formulário fica sem `error` nem `ok` para renderizar — a pessoa clica em
 * salvar, é jogada para outra tela e nada explica o porquê. Em action o certo é
 * devolver o erro para a UI mostrar, então use `checkRole` aqui.
 */
export async function checkRole(
  role: UserRole,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sua sessão expirou — entre novamente." };
  if (user.role !== role) {
    return { ok: false, error: "Apenas administradores podem fazer isso." };
  }
  return { ok: true, user };
}

function clientIp(hdrs: Headers): string | null {
  const xff = hdrs.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return hdrs.get("x-real-ip");
}

export { COOKIE_NAME };
