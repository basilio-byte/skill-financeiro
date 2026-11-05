import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { cn } from "@/lib/ui";
import { PageHeader } from "@/components/page-header";
import { mensagemVerificada } from "@/lib/exportacao/assinatura";
import { CONJUNTOS, conjuntosDoPapel } from "@/lib/exportacao/conjuntos";
import { um, type ParamsBrutos } from "@/lib/exportacao/parametros";
import type { Papel } from "@/lib/exportacao/tipos";
import { PainelReceita } from "./painel-receita";
import { PainelInadimplencia } from "./painel-inadimplencia";
import { PainelMetas } from "./painel-metas";
import { PainelRegras } from "./painel-regras";
import { PainelConflitos } from "./painel-conflitos";
import { PainelSincronizacoes } from "./painel-sincronizacoes";
import { PainelClickUp } from "./painel-clickup";
import { PainelAcessos } from "./painel-acessos";
import { HistoricoExportacoes } from "./historico";

export const metadata: Metadata = { title: "Exportar" };
export const dynamic = "force-dynamic";

/**
 * Central de exportação (ADR-0035): baixar os dados do painel em planilha, com filtros. Só LEITURA — nada aqui
 * escreve em receita, metas ou sincronização. Visível a todos os papéis; o que é só de administrador (dados
 * pessoais, conjuntos administrativos, histórico) é conferido de novo no servidor, não só escondido na tela.
 */
export default async function ExportarPage({ searchParams }: { searchParams: Promise<ParamsBrutos> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const papel: Papel = user.role;
  const conjuntos = conjuntosDoPapel(papel);
  const pedido = um(sp.dataset);
  const ativo = conjuntos.find((c) => c.id === pedido) ?? conjuntos[0]!;
  // Link de um conjunto que este papel não vê (ex.: o admin colou o link do ClickUp para um visualizador): avisa, e abre
  // o conjunto padrão SEM os parâmetros do outro (eles não fazem sentido ali e dariam erro ou um recorte inesperado).
  const restrito = CONJUNTOS.find((c) => c.id === pedido && !conjuntos.some((x) => x.id === c.id));
  const paramsDoPainel: ParamsBrutos = restrito ? { dataset: ativo.id } : sp;
  // A mensagem de erro vem na URL ASSINADA pela rota de download: link forjado não vira alerta "oficial" na tela.
  const erro = mensagemVerificada(getEnv().SESSION_SECRET, um(sp.erro).slice(0, 600), um(sp.sig));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo="Exportar" descricao="Baixe os dados do painel em planilha, com filtros." />

      {erro ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Não foi possível gerar a planilha.</p>
          <p className="mt-0.5">{erro}</p>
        </div>
      ) : null}

      {restrito ? (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          O conjunto “{restrito.titulo}” é só para administradores. Abri “{ativo.titulo}” no lugar.
        </div>
      ) : null}

      {conjuntos.length > 1 ? (
        <nav aria-label="Conjuntos de dados" className="flex flex-wrap gap-2">
          {conjuntos.map((c) => {
            const atual = c.id === ativo.id;
            return (
              <Link
                key={c.id}
                href={`/exportar?dataset=${c.id}`}
                aria-current={atual ? "page" : undefined}
                title={c.descricao}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition",
                  atual ? "border-seahub-600 bg-seahub-50 text-acento-texto" : "border-slate-200 bg-card text-slate-700 hover:bg-slate-50",
                )}
              >
                {c.titulo}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="-mt-2 flex flex-col gap-1 text-sm text-slate-500">
        <p>{ativo.descricao}</p>
        <p className="text-[13px] text-slate-400">
          Os arquivos .xlsx abrem direto nos dados (resumos só se você marcar) e levam, na última aba, um Leia-me com os filtros, a hora e a atualidade; o CSV traz só o detalhe. Antes de entregar, cada arquivo é relido e conferido, e as somas de receita, inadimplentes,
          conflitos e ClickUp também contra o banco. Nesta tela, dados pessoais só para administradores.
        </p>
      </div>

      {ativo.id === "receita" ? <PainelReceita params={paramsDoPainel} papel={papel} /> : null}
      {ativo.id === "inadimplencia" ? <PainelInadimplencia params={paramsDoPainel} papel={papel} /> : null}
      {ativo.id === "metas" ? <PainelMetas params={paramsDoPainel} /> : null}
      {ativo.id === "regras" ? <PainelRegras params={paramsDoPainel} /> : null}
      {ativo.id === "conflitos" ? <PainelConflitos params={paramsDoPainel} papel={papel} /> : null}
      {ativo.id === "sincronizacoes" ? <PainelSincronizacoes params={paramsDoPainel} papel={papel} /> : null}
      {ativo.id === "clickup" ? <PainelClickUp params={paramsDoPainel} papel={papel} /> : null}
      {ativo.id === "acessos" ? <PainelAcessos params={paramsDoPainel} papel={papel} /> : null}

      {papel === "ADMIN" ? <HistoricoExportacoes /> : null}
    </div>
  );
}
