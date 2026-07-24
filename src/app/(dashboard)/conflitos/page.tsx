import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card, SectionTitle } from "@/components/ui";
import { ConflitoCard } from "@/components/conflito-card";
import { listarConflitos } from "@/lib/categorization/conflitos";

export const metadata: Metadata = { title: "Conflitos" };

export default async function ConflitosPage() {
  await requireRole("ADMIN");
  const conflitos = await listarConflitos();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conflitos</h1>
        <p className="text-sm text-slate-500">
          Faturas cuja soma das linhas atuais não bate com o valor real (possível dupla contagem) — sempre atual,
          não escopado a uma rodada específica.
        </p>
      </div>

      <Card>
        <SectionTitle hint={`${conflitos.length} fatura(s)`}>Faturas com possível dupla contagem</SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          Acontece quando uma linha revisada manualmente (nunca apagada sozinha, pra nunca perder uma correção
          humana) fica ao lado de uma linha nova gerada pelo motor pra mesma fatura. Casos com um padrão claro
          (marcados abaixo) podem ser resolvidos com um clique; os demais precisam de decisão manual — exclua a
          linha errada depois de conferir os valores.
        </p>
        {conflitos.length === 0 ? (
          <p className="py-6 text-center text-slate-400">Nenhum conflito em aberto.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {conflitos.map((f) => (
              <ConflitoCard key={f.crConexaId} fatura={f} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
