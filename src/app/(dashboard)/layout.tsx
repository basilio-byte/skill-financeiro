import { requireUser } from "@/lib/auth/session";
import { Shell, type GrupoNav } from "@/components/shell";

// Toda tela daqui pra baixo lê sessão/banco por requisição — nunca prerenderizar
// estaticamente no build (evita erros de "DATABASE_URL ausente" no build sem
// banco, e garante dado sempre fresco).
export const dynamic = "force-dynamic";

/**
 * Mesmas rotas e mesma regra de visibilidade de antes (itens `adminOnly` só para ADMIN); o que mudou é
 * o agrupamento e o ícone. Visão = o que se lê; Operação = o que se trabalha; Administração = quem e o quê.
 */
const NAV: Array<{ titulo: string; itens: Array<GrupoNav["itens"][number] & { adminOnly?: boolean }> }> = [
  {
    titulo: "Visão",
    itens: [
      { href: "/", rotulo: "Panorama", icone: "panorama" },
      { href: "/metas", rotulo: "Metas", icone: "metas" },
      { href: "/inadimplentes", rotulo: "Inadimplentes", icone: "inadimplentes" },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { href: "/revisar", rotulo: "Revisar", icone: "revisar" },
      { href: "/runs", rotulo: "Sincronizações", icone: "sincronizacoes" },
      { href: "/categorias", rotulo: "Categorias", icone: "categorias" },
      { href: "/conflitos", rotulo: "Conflitos", icone: "conflitos", adminOnly: true },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { href: "/contas", rotulo: "Contas", icone: "contas", adminOnly: true },
      { href: "/integracoes/clickup", rotulo: "ClickUp", icone: "integracao", adminOnly: true },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const grupos: GrupoNav[] = NAV.map((g) => ({
    titulo: g.titulo,
    itens: g.itens.filter((i) => !i.adminOnly || user.role === "ADMIN").map(({ adminOnly: _a, ...item }) => item),
  })).filter((g) => g.itens.length > 0);

  return (
    <Shell grupos={grupos} nome={user.name} email={user.email} papel={user.role === "ADMIN" ? "Administrador" : "Visualizador"}>
      {children}
    </Shell>
  );
}
