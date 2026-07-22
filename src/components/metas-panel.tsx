import Link from "next/link";
import { formatBRL, formatPercent } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import type { MetasDoPeriodo, MetaEscopoResolvido } from "@/lib/metas/metas";

/**
 * Metas do período no Panorama.
 *
 * Forma: um medidor horizontal por escopo. Não usa bullet chart nem um KPI
 * card por unidade — com 3 escopos, medidores empilhados dão comparação
 * imediata entre eles e sobra espaço para o valor absoluto ao lado, que é o
 * que o financeiro realmente lê.
 *
 * Cor NUNCA é o único indicador (o projeto já corrigiu um bug real de
 * contraste, ver progress.md): o percentual vem escrito, e o estado também
 * aparece no texto de apoio.
 */

/** Largura da barra: satura em 100% — o excedente é dito em texto, não desenhado. */
function larguraPct(percentual: number | null): number {
  if (percentual === null) return 0;
  return Math.max(0, Math.min(100, percentual));
}

function corDaBarra(percentual: number | null, ritmo: number | null): string {
  if (percentual === null) return "bg-slate-300";
  if (percentual >= 100) return "bg-positive";
  // Só chama de "atrasado" quando há um ritmo de referência para comparar.
  if (ritmo !== null && percentual < ritmo - 10) return "bg-warning";
  return "bg-seahub-500";
}

function MetaRow({ escopo, ritmo }: { escopo: MetaEscopoResolvido; ritmo: number | null }) {
  const temMeta = escopo.meta !== null && escopo.percentual !== null;
  const largura = larguraPct(escopo.percentual);

  return (
    <li className="py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-slate-800">{escopo.nome}</span>
        <span className="text-sm tabular-nums text-slate-600">
          {temMeta ? (
            <>
              <strong className="text-slate-900">{formatBRL(escopo.realizado)}</strong>
              <span className="text-slate-400"> de </span>
              {formatBRL(escopo.meta as string)}
              <span className="ml-2 font-semibold text-slate-900">{formatPercent(escopo.percentual)}</span>
            </>
          ) : (
            <>
              <strong className="text-slate-900">{formatBRL(escopo.realizado)}</strong>
              <span className="ml-2 text-slate-400">sem meta definida</span>
            </>
          )}
        </span>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={
          temMeta
            ? `${escopo.nome}: ${formatPercent(escopo.percentual)} da meta (${formatBRL(escopo.realizado)} de ${formatBRL(escopo.meta as string)})`
            : `${escopo.nome}: ${formatBRL(escopo.realizado)}, sem meta definida`
        }
      >
        <div
          className={`h-full rounded-full transition-all ${corDaBarra(escopo.percentual, ritmo)}`}
          style={{ width: `${largura}%` }}
        />
        {/* Marcador de ritmo: mesma escala 0..100 da barra, então a posição é
            diretamente comparável ao preenchimento. */}
        {temMeta && ritmo !== null ? (
          <span
            className="absolute top-0 h-full w-px bg-slate-500/70"
            style={{ left: `${Math.min(100, ritmo)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {temMeta ? (
        <p className="mt-1 text-xs text-slate-500">
          {(escopo.percentual as number) >= 100
            ? `Meta batida — ${formatBRL(escopo.realizado)} sobre ${formatBRL(escopo.meta as string)}.`
            : `Faltam ${formatBRL(escopo.falta as string)}.`}
          {escopo.mesesComMeta > 1 ? ` Soma de ${escopo.mesesComMeta} meses.` : ""}
        </p>
      ) : null}
    </li>
  );
}

export function MetasPanel({ metas }: { metas: MetasDoPeriodo }) {
  if (!metas.aplicavel) {
    return (
      <Card>
        <SectionTitle>Metas</SectionTitle>
        <p className="text-sm text-slate-500">
          {metas.motivo}{" "}
          <Link href="/?g=month" className="text-seahub-600 hover:underline">
            Ver por mês
          </Link>
          .
        </p>
      </Card>
    );
  }

  if (!metas.temEscopos) {
    return (
      <Card>
        <SectionTitle>Metas</SectionTitle>
        <p className="text-sm text-slate-500">
          Nenhum escopo de meta cadastrado ainda —{" "}
          <Link href="/metas" className="text-seahub-600 hover:underline">
            configurar em Metas
          </Link>
          .
        </p>
      </Card>
    );
  }

  const semNenhumaMeta = metas.totalMeta === null;

  return (
    <Card>
      <SectionTitle
        hint={
          metas.ritmoEsperadoPct !== null
            ? `período em andamento — a marca no traço é o ritmo linear até hoje (${formatPercent(metas.ritmoEsperadoPct)})`
            : "por Data de Crédito da Cobrança"
        }
      >
        Metas
      </SectionTitle>

      {semNenhumaMeta ? (
        <p className="mb-2 text-sm text-slate-500">
          Nenhuma meta definida para este período. Os valores abaixo são o realizado —{" "}
          <Link href="/metas" className="text-seahub-600 hover:underline">
            definir metas
          </Link>
          .
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">
            {formatPercent(metas.percentualTotal)}
          </span>
          <span className="text-sm text-slate-600">
            {formatBRL(metas.totalRealizado)} de {formatBRL(metas.totalMeta as string)} no total
          </span>
        </div>
      )}

      {!metas.metaCompleta && !semNenhumaMeta ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Nem todos os {metas.mesesNoPeriodo} meses deste período têm meta definida. Para não comparar coisas
          diferentes, o realizado mostrado considera <strong>apenas os meses que têm meta</strong> — então este
          número não é a receita total do período.
        </p>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {metas.escopos.map((e) => (
          <MetaRow key={e.slug} escopo={e} ritmo={metas.ritmoEsperadoPct} />
        ))}
      </ul>

      {metas.ritmoEsperadoPct !== null && !semNenhumaMeta ? (
        <p className="mt-3 text-xs text-slate-400">
          O traço vertical marca {formatPercent(metas.ritmoEsperadoPct)} — onde o período estaria se a receita entrasse por
          igual todos os dias. É só uma referência: como a Data de Crédito se concentra nas datas de
          vencimento, ficar atrás do traço no começo do período é normal.
        </p>
      ) : null}
    </Card>
  );
}
