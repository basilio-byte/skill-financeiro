"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/ui";
import { Assinatura } from "@/components/logo";
import {
  IconCategorias,
  IconConflitos,
  IconContas,
  IconFechar,
  IconInadimplentes,
  IconIntegracao,
  IconMenu,
  IconMetas,
  IconPanorama,
  IconRevisar,
  IconSair,
  IconSincronizacoes,
  IconUsuario,
} from "@/components/icons";

/**
 * Estrutura de navegação: barra lateral agrupada (desktop) e gaveta (celular).
 *
 * ⚠ Só APRESENTAÇÃO. Os links, as rotas e a regra de quem enxerga o quê (itens de administração só para
 * ADMIN) vêm do layout do servidor — exatamente os mesmos da barra superior de antes; aqui eles só ganham
 * agrupamento e ícone. O logout continua sendo a mesma server action.
 */

const ICONES = {
  panorama: IconPanorama,
  metas: IconMetas,
  inadimplentes: IconInadimplentes,
  revisar: IconRevisar,
  sincronizacoes: IconSincronizacoes,
  categorias: IconCategorias,
  conflitos: IconConflitos,
  contas: IconContas,
  integracao: IconIntegracao,
} as const;

export interface ItemNav {
  href: string;
  rotulo: string;
  icone: keyof typeof ICONES;
}
export interface GrupoNav {
  titulo: string;
  itens: ItemNav[];
}

/** "/" só marca ativo em correspondência exata, senão marcaria tudo. */
export function estaAtivo(href: string, caminho: string): boolean {
  return href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(`${href}/`);
}

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

function Navegacao({
  grupos,
  nome,
  email,
  papel,
  aoNavegar,
}: {
  grupos: GrupoNav[];
  nome: string;
  email: string;
  papel: string;
  aoNavegar?: () => void;
}) {
  const caminho = usePathname();

  return (
    <nav aria-label="Principal" className="flex h-full flex-col bg-marca">
      <Link
        href="/"
        onClick={aoNavegar}
        aria-label="Financeiro Seahub — ir para o Panorama"
        className="px-5 pb-4 pt-6 transition-opacity hover:opacity-90"
      >
        <Assinatura altura={28} />
      </Link>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {grupos.map((g) => (
          <div key={g.titulo}>
            <p className="px-2.5 pb-1.5 text-[11.5px] font-medium text-[var(--marca-tinta-3)]">{g.titulo}</p>
            <ul className="space-y-0.5">
              {g.itens.map((i) => {
                const Icone = ICONES[i.icone];
                const ativo = estaAtivo(i.href, caminho);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={aoNavegar}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors",
                        ativo
                          ? "bg-[var(--marca-ativo)] text-[var(--marca-tinta)]"
                          : "text-[var(--marca-tinta-2)] hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]",
                      )}
                    >
                      <Icone size={17} className={ativo ? "text-[var(--marca-tinta)]" : "text-[var(--marca-tinta-3)]"} />
                      {i.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--marca-borda)] p-3">
        <Link
          href="/minha-conta"
          onClick={aoNavegar}
          title="Minha conta"
          aria-current={caminho === "/minha-conta" ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
            caminho === "/minha-conta" ? "bg-[var(--marca-ativo)]" : "hover:bg-[var(--marca-hover)]",
          )}
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--marca-ativo)] text-[12px] font-semibold text-[var(--marca-tinta)]"
          >
            {iniciais(nome) || <IconUsuario size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-[var(--marca-tinta)]">{nome}</span>
            <span className="block truncate text-[12px] text-[var(--marca-tinta-3)]" title={email}>
              {papel}
            </span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-[var(--marca-tinta-2)] transition-colors hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]"
          >
            <IconSair size={16} className="text-[var(--marca-tinta-3)]" />
            Sair
          </button>
        </form>
      </div>
    </nav>
  );
}

export function Shell({
  grupos,
  nome,
  email,
  papel,
  children,
}: {
  grupos: GrupoNav[];
  nome: string;
  email: string;
  papel: string;
  children: React.ReactNode;
}) {
  const caminho = usePathname();
  const [aberta, setAberta] = useState(false);

  // Fecha a gaveta ao navegar e com Esc; trava a rolagem do corpo enquanto aberta.
  useEffect(() => setAberta(false), [caminho]);
  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && setAberta(false);
    document.addEventListener("keydown", aoTeclar);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = anterior;
    };
  }, [aberta]);

  const nav = { grupos, nome, email, papel };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* Desktop: lateral fixa na altura da tela. */}
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Navegacao {...nav} />
      </aside>

      {/* Celular: barra superior da cor da marca com o botão da gaveta. */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-marca px-4 py-3 lg:hidden">
        <Link href="/" aria-label="Financeiro Seahub — ir para o Panorama">
          <Assinatura altura={22} />
        </Link>
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-label="Abrir menu"
          aria-expanded={aberta}
          className="rounded-lg p-2 text-[var(--marca-tinta)] transition-colors hover:bg-[var(--marca-hover)]"
        >
          <IconMenu size={20} />
        </button>
      </header>

      {aberta ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberta(false)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="absolute inset-y-0 left-0 w-[272px] shadow-3">
            <Navegacao {...nav} aoNavegar={() => setAberta(false)} />
            <button
              type="button"
              onClick={() => setAberta(false)}
              aria-label="Fechar menu"
              className="absolute right-3 top-5 rounded-lg p-1.5 text-[var(--marca-tinta-2)] hover:bg-[var(--marca-hover)]"
            >
              <IconFechar size={18} />
            </button>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto w-full max-w-[1320px]">{children}</div>
      </main>
    </div>
  );
}
