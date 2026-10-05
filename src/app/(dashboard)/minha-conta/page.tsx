import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { listarTokensMcp } from "@/lib/mcp/tokens";
import { Card, SectionTitle } from "@/components/ui";
import { ChangePasswordForm } from "@/components/contas-panel";
import { TokensMcpPanel } from "@/components/tokens-mcp-panel";

export const metadata: Metadata = { title: "Minha conta" };

export default async function MinhaContaPage() {
  const user = await requireUser();
  const ehAdmin = user.role === "ADMIN";

  // Admin enxerga todos (para revogar o de quem saiu); os demais, só os próprios.
  const tokens = await listarTokensMcp(ehAdmin ? {} : { userId: user.id });
  const linhas = tokens.map((t) => ({
    id: t.id,
    nome: t.nome,
    prefixo: t.prefixo,
    escopo: t.escopo,
    criadoEm: t.criadoEm.toISOString(),
    ultimoUsoEm: t.ultimoUsoEm?.toISOString() ?? null,
    revogadoEm: t.revogadoEm?.toISOString() ?? null,
    dono: t.dono.email,
    meu: t.dono.id === user.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-md">
        <h1 className="font-semibold text-slate-900">Minha conta</h1>
        <p className="text-sm text-slate-500">
          {user.name} · {user.email} · {user.role === "ADMIN" ? "Administrador" : "Visualizador"}
        </p>
      </Card>
      <Card className="max-w-md">
        <SectionTitle>Trocar senha</SectionTitle>
        <ChangePasswordForm />
      </Card>
      <Card>
        <SectionTitle hint="para conectar o Claude ao painel">Tokens do MCP</SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          O MCP deixa um cliente de IA (Claude Code, Claude Desktop) consultar a receita, as metas, as sincronizações e
          os inadimplentes, e — com acesso de escrita — revisar linhas, regras e metas. Cada token é seu e revogável; toda
          escrita fica registrada com o seu nome. O valor aparece uma única vez, ao criar.
        </p>
        <TokensMcpPanel tokens={linhas} ehAdmin={ehAdmin} urlDoMcp={`${getEnv().APP_URL.replace(/\/$/, "")}/api/mcp`} />
      </Card>
    </div>
  );
}
