import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";

// Toda tela daqui pra baixo lê sessão/banco por requisição — nunca prerenderizar
// estaticamente no build (evita erros de "DATABASE_URL ausente" no build sem
// banco, e garante dado sempre fresco).
export const dynamic = "force-dynamic";

const NAV: Array<{ href: string; label: string; adminOnly?: boolean }> = [
  { href: "/", label: "Panorama" },
  { href: "/revisar", label: "Revisar" },
  { href: "/runs", label: "Sincronizações" },
  { href: "/categorias", label: "Categorias" },
  { href: "/metas", label: "Metas" },
  { href: "/conflitos", label: "Conflitos", adminOnly: true },
  { href: "/contas", label: "Contas", adminOnly: true },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.png" alt="Seahub" width={120} height={41} priority className="h-8 w-auto" />
              <span className="sr-only">Financeiro Seahub</span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/minha-conta"
              className="hidden rounded-lg px-2 py-1 text-right transition hover:bg-slate-100 sm:block"
              title="Minha conta"
            >
              <p className="text-sm font-medium text-slate-800">{user.name}</p>
              <p className="text-xs text-slate-500">{user.role === "ADMIN" ? "Administrador" : "Visualizador"}</p>
            </Link>
            <form action={logoutAction}>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-400">
        Seahub Coworking · Financeiro Seahub · categorização de receita a partir do ERP Conexa
      </footer>
    </div>
  );
}
