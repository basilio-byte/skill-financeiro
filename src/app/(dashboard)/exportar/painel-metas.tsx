import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { lerPedidoMetas } from "@/lib/exportacao/pasta-metas";
import { Caixa, ErrosDoPedido, Grupo, RodapeDeDownload, formatoDe, href } from "./campos";

/**
 * Painel de exportação de METAS (ADR-0035). O realizado sai do mesmo cálculo da tela Metas/Panorama; aqui a prévia só
 * conta o que existe no ano escolhido (metas definidas e alterações registradas).
 */

const ID_FORM = "form-exportar-metas";

export async function PainelMetas({ params }: { params: ParamsBrutos }) {
  const anoAtual = Number(todayKey().slice(0, 4));
  const { pedido, erros } = lerPedidoMetas(params, anoAtual);

  const [escopos, definidas, alteracoes] = await Promise.all([
    prisma.metaEscopo.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { slug: true, nome: true, todasCategorias: true } }),
    prisma.metaPeriodo.count({ where: { periodoChave: { startsWith: `${pedido.ano}-` } } }),
    prisma.metaPeriodoEvent.count({ where: { metaPeriodo: { periodoChave: { startsWith: `${pedido.ano}-` } } } }),
  ]);
  const anos = [anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1];
  if (!anos.includes(pedido.ano)) anos.push(pedido.ano);
  anos.sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Meta × realizado.">Metas</SectionTitle>
        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="metas" />
          <input type="hidden" name="f" value="1" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="me-ano">
                Ano
              </label>
              <select id="me-ano" name="ano" defaultValue={String(pedido.ano)} className="input">
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Grupo legenda="Tipo de meta" dica="As duas são séries independentes. Nenhuma marcada = as duas.">
            <Caixa nome="tipo" valor="mensal" rotulo="Mensal" marcado={pedido.granularidades.includes("MES") && pedido.granularidades.length === 1} />
            <Caixa nome="tipo" valor="trimestral" rotulo="Trimestral" marcado={pedido.granularidades.includes("TRIMESTRE") && pedido.granularidades.length === 1} />
          </Grupo>
          <Grupo legenda="Escopo" dica="Nenhum marcado = todos os escopos ativos.">
            {escopos.map((e) => (
              <Caixa key={e.slug} nome="escopo" valor={e.slug} rotulo={e.todasCategorias ? `${e.nome} (todas as categorias)` : e.nome} marcado={pedido.escopos.includes(e.slug)} />
            ))}
          </Grupo>
          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle hint="do ano escolhido">Prévia do arquivo</SectionTitle>
        {erros.length > 0 ? (
          <ErrosDoPedido erros={erros} />
        ) : (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <KpiCard label="Ano" value={String(pedido.ano)} />
              <KpiCard label="Escopos ativos" value={String(escopos.length)} />
              <KpiCard label="Metas definidas no ano" value={definidas.toLocaleString("pt-BR")} hint="mensais + trimestrais" />
              <KpiCard label="Alterações registradas" value={alteracoes.toLocaleString("pt-BR")} />
            </KpiStrip>
            <p className="text-[13px] text-slate-600">
              O realizado é calculado ao vivo, por Data de Crédito, pelo mesmo cálculo da tela Metas. A planilha traz uma aba por assunto: Metas e realizado, Histórico de alterações e Escopos.{" "}
              <a className="text-acento-texto hover:underline" href={href([["dataset", "metas"], ["ano", String(anoAtual)]])}>
                Voltar ao ano atual
              </a>
              .
            </p>
          </div>
        )}
        <RodapeDeDownload idForm={ID_FORM} rota="metas" formatoAtual={formatoDe(params)} formatos={["xlsx", "csv"]} nota="O .xlsx traz as abas Metas e realizado, Histórico de alterações e Escopos." />
      </Card>
    </div>
  );
}
