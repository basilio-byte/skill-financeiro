import Link from "next/link";
import { comInicialMaiuscula } from "@/lib/dates";
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
 *
 * Cada bloco mostra SÓ os escopos com meta naquele período (2026-07-30). Com 6
 * escopos e meta em 1, as outras 5 linhas de "sem meta definida" viravam ruído
 * numa tela cujo assunto é progresso contra meta. Não é omissão silenciosa: o
 * rodapé do bloco diz quantos ficaram de fora, e o realizado por categoria
 * continua no breakdown "por categoria" do próprio Panorama.
 */

/** Largura da barra: satura em 100% — o excedente é dito em texto, não desenhado. */
function larguraPct(percentual: number | null): number {
  if (percentual === null) return 0;
  return Math.max(0, Math.min(100, percentual));
}

/**
 * "Tem meta" para efeito de EXIBIÇÃO: meta definida E comparável.
 *
 * Uma meta de R$ 0,00 é aceita pelo formulário (`min="0"`, e a action só recusa
 * negativo) e pelo banco (`CHECK "valor" >= 0`), mas não produz percentual —
 * `pct()` devolve null quando o alvo é <= 0. A convenção registrada na própria
 * migration é que a UI trata 0 como "sem meta definida".
 *
 * Este predicado é usado nos DOIS lugares que decidem sobre meta: quem entra na
 * lista e como a linha é desenhada. Se eles discordassem, uma meta de R$ 0,00
 * produziria uma lista com uma única linha escrita "sem meta definida" — tendo
 * escondido as outras justamente por não terem meta.
 */
function temMetaComparavel(escopo: MetaEscopoResolvido): boolean {
  return escopo.meta !== null && escopo.percentual !== null;
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
  const temMeta = temMetaComparavel(escopo);
  const largura = larguraPct(escopo.percentual);

  return (
    <li className="py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-slate-800">
          {escopo.nome}
          {escopo.abrangeTudo ? (
            <span
              className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 align-middle text-[10px] font-normal text-slate-600"
              // Não cita "os outros escopos desta lista": desde que o card passou a
              // mostrar só quem tem meta, essa lista pode ter só esta linha.
              title="Soma toda a receita do período, sem filtrar categoria — inclui a dos demais escopos. Por isso não entra no total acima: somar tudo contaria o mesmo dinheiro duas vezes."
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
  const comMeta = bloco.escopos.filter(temMetaComparavel);
  // Fallback ESTRUTURAL, não estético: sem meta comparável no período a lista
  // ficaria vazia e o bloco não diria nada. Nesse caso mostra todos como
  // realizado — é o estado em que a pessoa está calibrando quanto pedir.
  // (A lista em si não ser vazia vem do gate `temEscopos` em MetasPanel.)
  const visiveis = comMeta.length > 0 ? comMeta : bloco.escopos;
  const ocultos = bloco.escopos.length - visiveis.length;

  // Tudo abaixo deriva de `comMeta`, e não de um campo separado vindo do
  // servidor: é o que garante que a mensagem não contradiga as linhas exibidas.
  const semMeta = comMeta.length === 0;
  // percentualTotal só é null quando totalMeta é <= 0, então este par também
  // impede um cabeçalho "—%" sobre "de R$ 0,00".
  const temAgregado = bloco.totalMeta !== null && bloco.percentualTotal !== null;
  const globalComMeta = comMeta.some((e) => e.abrangeTudo);

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-700">{ehMensal ? "Mensal" : "Trimestral"}</h3>
        {/* O período apurado, sempre explícito — é o que impede confundir o
            realizado deste bloco com o KPI da página quando os recortes diferem. */}
        <span className="text-xs text-slate-500">{comInicialMaiuscula(bloco.label)}</span>
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
        {visiveis.map((e) => (
          <MetaRow key={e.slug} escopo={e} ritmo={bloco.ritmoEsperadoPct} unidadePlural={unidadePlural} />
        ))}
      </ul>

      {/* Diz o que ficou de fora. Sem esta linha, um escopo que existe e tem
          receita simplesmente não estaria na tela — e "some sem avisar" é
          exatamente o que este projeto trata como bug em tela de dinheiro. */}
      {/* slate-600 (7,6:1) e não slate-400 (2,55:1, reprova WCAG 1.4.3): esta
          linha não é nota de rodapé, é a única coisa que avisa que escopos com
          receita real saíram da lista. Se ela é o que desaparece num monitor
          claro, a omissão volta a ser silenciosa. */}
      {ocultos > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          {ocultos === 1 ? "1 escopo sem meta" : `${ocultos} escopos sem meta`} {ehMensal ? "mensal" : "trimestral"} —
          fora desta lista.{" "}
          <Link href="/metas" className="text-seahub-600 hover:underline">
            Definir
          </Link>
          .
        </p>
      ) : null}

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
