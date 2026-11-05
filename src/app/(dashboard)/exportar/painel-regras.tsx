import { Card, SectionTitle } from "@/components/ui";
import { KpiCard, KpiStrip } from "@/components/kpi-card";
import { prisma } from "@/lib/db";
import { listCategoriasConhecidas } from "@/lib/categorization/categorias";
import type { ParamsBrutos } from "@/lib/exportacao/parametros";
import { lerPedidoRegras } from "@/lib/exportacao/pasta-regras";
import { Caixa, ErrosDoPedido, OpcaoComDescricao, RodapeDeDownload, formatoDe } from "./campos";

/**
 * Painel de exportação das REGRAS DE CATEGORIA (ADR-0035): a tabela que mapeia serviço/plano → categoria, e o que ainda
 * está sem categoria. A prévia só conta; nomes saem com o espaçamento exato do banco.
 */

const ID_FORM = "form-exportar-regras";

export async function PainelRegras({ params }: { params: ParamsBrutos }) {
  const { pedido, erros } = lerPedidoRegras(params);
  const categorias = await listCategoriasConhecidas();

  const where = {
    ...(pedido.ativo === "ativas" ? { ativo: true } : pedido.ativo === "inativas" ? { ativo: false } : {}),
    ...(pedido.categorias.length ? { categoria: { in: pedido.categorias } } : {}),
    ...(pedido.busca ? { nome: { contains: pedido.busca, mode: "insensitive" as const } } : {}),
  };
  const [total, ativas, pend] = erros.length
    ? [0, 0, { _count: { _all: 0 }, _sum: { valorRecebidoCat: null } }]
    : await Promise.all([
        prisma.revenueCategoryRule.count({ where }),
        prisma.revenueCategoryRule.count({ where: { ...where, ativo: true } }),
        prisma.revenueCategorizedLine.aggregate({ where: { categoria: "Sem Categoria", servicoOuPlano: { not: "" } }, _count: { _all: true }, _sum: { valorRecebidoCat: true } }),
      ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle hint="Serviço/plano → categoria.">Regras de categoria</SectionTitle>
        <form id={ID_FORM} method="get" action="/exportar" className="flex flex-col gap-5">
          <input type="hidden" name="dataset" value="regras" />
          <input type="hidden" name="f" value="1" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="rg-ativo">
                Situação das regras
              </label>
              <select id="rg-ativo" name="ativo" defaultValue={pedido.ativo} className="input">
                <option value="todas">Todas (ativas e inativas)</option>
                <option value="ativas">Somente ativas</option>
                <option value="inativas">Somente inativas</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="rg-busca">
                Nome contém
              </label>
              <input id="rg-busca" name="busca" defaultValue={pedido.busca ?? ""} placeholder="parte do nome do serviço/plano" className="input" />
            </div>
          </div>
          <details open={pedido.categorias.length > 0} className="rounded-lg border border-slate-200/80 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-slate-700">
              Categoria{pedido.categorias.length ? ` — ${pedido.categorias.length} selecionada(s)` : " — todas"}
            </summary>
            <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {categorias.map((c) => (
                <Caixa key={c} nome="categoria" valor={c} rotulo={c} marcado={pedido.categorias.includes(c)} />
              ))}
            </div>
          </details>
          <OpcaoComDescricao
            id="rg-pendencias"
            nome="pendencias"
            valor="1"
            rotulo="Aba 'Sem categoria'"
            descricao="Os nomes de serviço/plano que ainda não têm regra, com quantas linhas e quanto dinheiro cada um representa."
            marcado={pedido.pendencias}
          />
          <OpcaoComDescricao
            id="rg-resumos"
            nome="resumos"
            valor="1"
            rotulo="Aba de resumo 'Por categoria'"
            descricao="Quantas regras ativas e inativas cada categoria tem."
            marcado={pedido.resumos}
          />
          <div>
            <button type="submit" className="btn-secondary">
              Atualizar prévia
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle hint="do recorte aplicado acima">Prévia do arquivo</SectionTitle>
        {erros.length > 0 ? (
          <ErrosDoPedido erros={erros} />
        ) : (
          <KpiStrip>
            <KpiCard label="Regras neste recorte" value={Number(total).toLocaleString("pt-BR")} />
            <KpiCard label="Ativas" value={Number(ativas).toLocaleString("pt-BR")} />
            <KpiCard label="Linhas sem categoria" value={pend._count._all.toLocaleString("pt-BR")} tone={pend._count._all > 0 ? "negative" : "neutral"} hint="em qualquer mês" />
            <KpiCard label="Valor sem categoria" amount={pend._sum.valorRecebidoCat ? pend._sum.valorRecebidoCat.toFixed(2) : "0.00"} tone={pend._count._all > 0 ? "negative" : "neutral"} />
          </KpiStrip>
        )}
        <RodapeDeDownload idForm={ID_FORM} rota="regras" formatoAtual={formatoDe(params)} formatos={["xlsx", "csv"]} nota="Os nomes saem com o espaçamento exato do banco (a grafia com dois espaços é real)." />
      </Card>
    </div>
  );
}
