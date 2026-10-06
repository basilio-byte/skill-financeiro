"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/ui";
import { COOKIE_NAV } from "@/lib/nav-pref";
import { Assinatura } from "@/components/logo";
import {
  IconBarraLateral,
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
 * Estrutura de navegação: barra lateral agrupada (desktop, recolhível) e gaveta (celular).
 *
 * ⚠ Só APRESENTAÇÃO. Os links, as rotas e a regra de quem enxerga o quê (itens de administração só para
 * ADMIN) vêm do layout do servidor — exatamente os mesmos da barra superior de antes; aqui eles só ganham
 * agrupamento e ícone. O logout continua sendo a mesma server action.
 *
 * Recolher: a barra vira uma coluna de ícones (o texto continua no DOM, só escondido visualmente, e vira
 * `title`). A preferência fica num cookie lido pelo SERVIDOR (`COOKIE_NAV`, em lib/nav-pref.ts), e não em localStorage, para a
 * página já chegar do tamanho certo — com localStorage ela abriria larga e "piscaria" recolhida.
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
  compacta = false,
  aoAlternar,
}: {
  grupos: GrupoNav[];
  nome: string;
  email: string;
  papel: string;
  aoNavegar?: () => void;
  /** Só desktop: mostra só os ícones. */
  compacta?: boolean;
  /** Só desktop: presente = mostra o botão de recolher/expandir. */
  aoAlternar?: () => void;
}) {
  const caminho = usePathname();

  return (
    <nav aria-label="Principal" className="flex h-full flex-col bg-marca">
      <Link
        href="/"
        onClick={aoNavegar}
        aria-label="Financeiro Seahub — ir para o Panorama"
        className={cn(
          "pb-4 pt-6 transition-opacity hover:opacity-90",
          compacta ? "flex justify-center px-0" : "px-5",
        )}
      >
        {compacta ? (
          // O monograma oficial (branco sobre transparente; a barra é sempre da cor da marca).
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/seahub-monograma.png" alt="Seahub" width={30} height={30} className="block h-[30px] w-[30px]" />
        ) : (
          <Assinatura altura={28} />
        )}
      </Link>

      <div className={cn("flex-1 overflow-y-auto py-4", compacta ? "space-y-3 px-2" : "space-y-6 px-3")}>
        {grupos.map((g, indice) => (
          <div key={g.titulo}>
            {compacta ? (
              // Sem o título do grupo, um fio fino separa os grupos (o primeiro não precisa).
              indice > 0 ? <div aria-hidden className="mx-2 mb-3 h-px bg-[var(--marca-borda)]" /> : null
            ) : (
              <p className="px-2.5 pb-1.5 text-[11.5px] font-medium text-[var(--marca-tinta-3)]">{g.titulo}</p>
            )}
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
                      title={compacta ? i.rotulo : undefined}
                      className={cn(
                        "flex items-center rounded-lg py-2 text-[14px] font-medium transition-colors",
                        compacta ? "justify-center px-0" : "gap-2.5 px-2.5",
                        ativo
                          ? "bg-[var(--marca-ativo)] text-[var(--marca-tinta)]"
                          : "text-[var(--marca-tinta-2)] hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]",
                      )}
                    >
                      <Icone size={compacta ? 19 : 17} className={ativo ? "text-[var(--marca-tinta)]" : "text-[var(--marca-tinta-3)]"} />
                      <span className={compacta ? "sr-only" : undefined}>{i.rotulo}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={cn("border-t border-[var(--marca-borda)] py-3", compacta ? "px-2" : "px-3")}>
        {aoAlternar ? (
          <button
            type="button"
            onClick={aoAlternar}
            aria-expanded={!compacta}
            aria-label={compacta ? "Expandir a barra lateral" : "Recolher a barra lateral"}
            title={compacta ? "Expandir a barra lateral" : "Recolher a barra lateral"}
            className={cn(
              "mb-1 flex w-full items-center rounded-lg py-2 text-[13.5px] font-medium text-[var(--marca-tinta-2)] transition-colors hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]",
              compacta ? "justify-center px-0" : "gap-2.5 px-2.5",
            )}
          >
            <IconBarraLateral size={compacta ? 19 : 16} className="text-[var(--marca-tinta-3)]" />
            {compacta ? null : "Recolher"}
          </button>
        ) : null}

        <Link
          href="/minha-conta"
          onClick={aoNavegar}
          title={compacta ? `${nome} — Minha conta` : "Minha conta"}
          aria-current={caminho === "/minha-conta" ? "page" : undefined}
          className={cn(
            "flex items-center rounded-lg py-2 transition-colors",
            compacta ? "justify-center px-0" : "gap-3 px-2.5",
            caminho === "/minha-conta" ? "bg-[var(--marca-ativo)]" : "hover:bg-[var(--marca-hover)]",
          )}
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--marca-ativo)] text-[12px] font-semibold text-[var(--marca-tinta)]"
          >
            {iniciais(nome) || <IconUsuario size={15} />}
          </span>
          <span className={cn("min-w-0 flex-1", compacta && "sr-only")}>
            <span className="block truncate text-[13.5px] font-medium text-[var(--marca-tinta)]">{nome}</span>
            <span className="block truncate text-[12px] text-[var(--marca-tinta-3)]" title={email}>
              {papel}
            </span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            title={compacta ? "Sair" : undefined}
            className={cn(
              "mt-1 flex w-full items-center rounded-lg py-2 text-[13.5px] font-medium text-[var(--marca-tinta-2)] transition-colors hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]",
              compacta ? "justify-center px-0" : "gap-2.5 px-2.5",
            )}
          >
            <IconSair size={compacta ? 19 : 16} className="text-[var(--marca-tinta-3)]" />
            <span className={compacta ? "sr-only" : undefined}>Sair</span>
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
  inicialRecolhida = false,
  children,
}: {
  grupos: GrupoNav[];
  nome: string;
  email: string;
  papel: string;
  /** Preferência lida do cookie no servidor — a página já nasce do tamanho certo. */
  inicialRecolhida?: boolean;
  children: React.ReactNode;
}) {
  const caminho = usePathname();
  const [aberta, setAberta] = useState(false);
  const [recolhida, setRecolhida] = useState(inicialRecolhida);

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

  function alternar() {
    const proxima = !recolhida;
    setRecolhida(proxima);
    try {
      // Preferência de interface, não sessão: um ano, só neste site.
      document.cookie = `${COOKIE_NAV}=${proxima ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* sem cookie a preferência só dura até recarregar — a barra continua funcionando */
    }
  }

  const nav = { grupos, nome, email, papel };

  return (
    <div
      className={cn(
        "min-h-screen lg:grid lg:transition-[grid-template-columns] lg:duration-200 motion-reduce:transition-none",
        recolhida ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]",
      )}
    >
      {/* Desktop: lateral fixa na altura da tela, recolhível. */}
      <aside className="sticky top-0 hidden h-screen overflow-hidden lg:block">
        <Navegacao {...nav} compacta={recolhida} aoAlternar={alternar} />
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
