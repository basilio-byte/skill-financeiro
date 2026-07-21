import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";

// Toda tela daqui pra baixo lê sessão/banco por requisição — nunca prerenderizar
// estaticamente no build (evita erros de "DATABASE_URL ausente" no build sem
// banco, e garante dado sempre fresco).
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
            <span className="font-semibold text-slate-900">skill-financeiro</span>
            <Link href="/runs" className="hover:text-brand-600">
              Rodadas
            </Link>
            <Link href="/categorias" className="hover:text-brand-600">
              Categorias
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Link href="/minha-conta" className="hover:text-brand-600">
              {user.name}
            </Link>
            <form action={logoutAction}>
              <button className="btn-secondary" type="submit">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
