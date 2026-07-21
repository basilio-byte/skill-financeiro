import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Gate leve de autenticação (edge). Verifica a ASSINATURA do cookie de sessão e
 * redireciona para /login quando ausente/inválido. A validação autoritativa
 * (sessão no banco, expiração, papel) acontece nos server components via requireUser().
 *
 * Rotas fora do gate de sessão: /login e /api/health (healthcheck do Easypanel).
 */
const COOKIE_NAME = "skillfin_session";

const PUBLIC_PATHS = [/^\/login/, /^\/api\/health$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "");
      await jwtVerify(token, secret);
      return NextResponse.next();
    } catch {
      /* cai para o redirect abaixo */
    }
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
