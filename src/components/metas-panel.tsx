import Link from "next/link";
import { formatBRL, formatPercent } from "@/lib/money";
import { Card, SectionTitle } from "@/components/ui";
import type { BlocoMetas, MetasDoPeriodo, MetaEscopoResolvido } from "@/lib/metas/metas";

/**
 * Metas do período no Panorama.
 *
 * Mensal e trimestral aparecem LADO A LADO, cada uma apurada no seu próprio
 * período (ADR-0026 + ajuste de 2026-07-28). Antes o card mostrava só a
 * granularidade derivada da visão da página, então quem criava uma meta
 * trimestral e voltava ao Panorama — que abre em Mensal — não via nada, e a
 * tela ainda dizia "nenhuma meta definida".
 *
 * Cada bloco DIZ o período que apurou. Isso não é decoração: numa visão mensal
 * o bloco trimestral cobre o trimestre inteiro, então o realizado dele é
 * legitimamente maior que o KPI da página. Dois números de receita na mesma
 * tela só não enganam se cada um disser de que recorte é.
 *
 * Forma: um medidor horizontal por escopo. Cor NUNCA é o único indicador (o
 * projeto já corrigiu um bug real de contraste, ver progress.md): o percentual
 * vem escrito, e o estado também aparece no texto de apoio.
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

function MetaRow({
  escopo,
  ritmo,
  unidadePlural,
}: {
  escopo: MetaEscopoResolvido;
  ritmo: number | null;
  unidadePlural: "meses" | "trimestres";
}) {
  const temMeta = escopo.meta !== null && escopo.percentual !== null;
  const largura = larguraPct(escopo.percentual);

  return (
    <li className="py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-slate-800">
          {escopo.nome}
          {escopo.abrangeTudo ? (
            <span
              className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 align-middle text-[10px] font-normal text-slate-600"
              title="Soma toda a receita do período, sem filtrar categoria — inclui a dos outros escopos desta lista. Por isso não entra no total acima: somar tudo contaria o mesmo dinheiro duas vezes."
            >
              todas as categorias
            </span>
          ) : null}
        </span>
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
          {escopo.periodosComMeta > 1 ? ` Soma de ${escopo.periodosComMeta} ${unidadePlural}.` : ""}
        </p>
      ) : null}
    </li>
  );
}

function BlocoCard({ bloco }: { bloco: BlocoMetas }) {
  const ehMensal = bloco.granularidade === "MES";
  const unidadePlural = ehMensal ? "meses" : "trimestres";
  // Considera TODOS os escopos, inclusive o "todas as categorias": se a Duda
  // definir só a meta de Total recebido, `totalMeta` fica null (ele não entra no
  // agregado) e a mensagem de "nenhuma meta" faria a meta dela parecer
  // inexistente — o mesmo bug que já corrigimos hoje na visão trimestral.
  const semMeta = !bloco.temAlgumaMeta;
  const temAgregado = bloco.totalMeta !== null;
  const globalComMeta = bloco.escopos.some((e) => e.abrangeTudo && e.meta !== null);

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-700">{ehMensal ? "Mensal" : "Trimestral"}</h3>
        {/* O período apurado, sempre explícito — é o que impede confundir o
            realizado deste bloco com o KPI da página quando os recortes diferem. */}
        <span className="text-xs capitalize text-slate-500">{bloco.label}</span>
      </div>

      {semMeta ? (
        <p className="mb-2 text-sm text-slate-500">
          Nenhuma meta {ehMensal ? "mensal" : "trimestral"} para {bloco.label}. O valor abaixo é o realizado —{" "}
          <Link href="/metas" className="text-seahub-600 hover:underline">
            definir
          </Link>
          .
        </p>
      ) : temAgregado ? (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">
            {formatPercent(bloco.percentualTotal)}
          </span>
          <span className="text-sm text-slate-600">
            {formatBRL(bloco.totalRealizado)} de {formatBRL(bloco.totalMeta as string)}
          </span>
          {/* Sem esta ressalva, o agregado pareceria estar ignorando a meta de
              "Total recebido" por engano, quando na verdade ela é excluída de
              propósito (a receita dela contém a dos outros escopos). */}
          {globalComMeta ? (
            <span className="text-xs text-slate-400">não inclui &quot;todas as categorias&quot;</span>
          ) : null}
        </div>
      ) : null}

      {!bloco.metaCompleta && !semMeta ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Nem todos os {bloco.periodosNoIntervalo} {unidadePlural} deste intervalo têm meta. Para não comparar coisas
          diferentes, o realizado considera <strong>apenas os {unidadePlural} que têm meta</strong> — não é a receita
          total do intervalo.
        </p>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {bloco.escopos.map((e) => (
          <MetaRow key={e.slug} escopo={e} ritmo={bloco.ritmoEsperadoPct} unidadePlural={unidadePlural} />
        ))}
      </ul>

      {bloco.ritmoEsperadoPct !== null && !semMeta ? (
        <p className="mt-2 text-xs text-slate-400">
          O traço marca {formatPercent(bloco.ritmoEsperadoPct)} — onde o intervalo estaria se a receita entrasse por
          igual todos os dias. É referência, não previsão: a Data de Crédito se concentra nos vencimentos, então ficar
          atrás do traço no começo é normal.
        </p>
      ) : null}
    </section>
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
          </Link>{" "}
          ou{" "}
          <Link href="/?g=quarter" className="text-seahub-600 hover:underline">
            por trimestre
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

  // Só avisa da diferença de recorte quando ela existe de verdade (visão mensal
  // mostrando o trimestre inteiro ao lado). Sem isso, o realizado maior do
  // bloco trimestral pareceria contradizer o KPI da página.
  const algumBlocoDifere = metas.blocos.some((b) => b.difereDaVisao);

  return (
    <Card>
      <SectionTitle hint="por Data de Crédito da Cobrança">Metas</SectionTitle>

      {algumBlocoDifere ? (
        <p className="mb-3 text-xs text-slate-500">
          Metas mensais e trimestrais são independentes — cada bloco abaixo é apurado no seu próprio período, então o
          realizado de um pode ser maior que o do outro.
        </p>
      ) : null}

      <div className={`grid grid-cols-1 gap-4 ${metas.blocos.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {metas.blocos.map((b) => (
          <BlocoCard key={b.granularidade} bloco={b} />
        ))}
      </div>
    </Card>
  );
}
