import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { Card, SectionTitle } from "@/components/ui";
import { LinhaRevisaoRow, type LinhaRevisao } from "@/components/linha-revisao-row";
import { listCategoriasConhecidas } from "@/lib/categorization/categorias";
import { lerFiltrosRevisao, temFiltroRevisao } from "@/lib/categorization/filtros-revisao";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Revisar" };

const TAKE = 200;

/** "2026-09" → "Setembro de 2026". UTC, como o resto do app para datas sem hora. */
function mesPorExtenso(aaaaMm: string): string {
  const [a, m] = aaaaMm.split("-").map(Number);
  const t = new Date(Date.UTC(a!, m! - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function RevisarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = lerFiltrosRevisao(await searchParams);

  // Visão GLOBAL e sempre atual — desde o upsert por fatura (ADR-0013), uma
  // linha não pertence a uma rodada só, então "o que precisa de revisão" já
  // não é mais um conceito por-rodada (ver /runs/[id], que só mostra o que a
  // ÚLTIMA rodada tocou). Aqui é o inverso: todo o sistema, sem filtro de
  // rodada — não-revisadas primeiro, para funcionar como fila de trabalho.
  // Linhas com valor R$ 0,00 ficam de fora: no rateio elas existem só para
  // registrar que a categoria apareceu na fatura, não somam nada em lugar
  // nenhum, e revisá-las não muda número nenhum. Ficam contabilizadas abaixo
  // para a lista não parecer que perdeu linhas em silêncio.
  //
  // Filtros opcionais (task 86aktrw6v, pedido do financeiro): mês de crédito e Proporcionado. Sem eles,
  // o conjunto é EXATAMENTE o de antes (S + SEM_LV). Os três contadores usam o mesmo filtro, para a tela
  // nunca dizer "3 pendentes" sobre uma lista de outro recorte.
  const escopo: Prisma.RevenueCategorizedLineWhereInput = {
    proporcionado: filtros.proporcionado ?? { in: ["S", "SEM_LV"] },
    ...(filtros.mes ? { mesCredito: filtros.mes } : {}),
  };

  const [linhasRaw, totalPendentes, totalZerados, categorias, mesesBanco] = await Promise.all([
    prisma.revenueCategorizedLine.findMany({
      where: { ...escopo, valorRecebidoCat: { not: 0 } },
      orderBy: [{ revisadoManualmente: "asc" }, { crConexaId: "asc" }],
      take: TAKE,
      include: { revisadoPor: { select: { name: true } } },
    }),
    prisma.revenueCategorizedLine.count({
      where: { ...escopo, valorRecebidoCat: { not: 0 }, revisadoManualmente: false },
    }),
    prisma.revenueCategorizedLine.count({
      where: { ...escopo, valorRecebidoCat: 0 },
    }),
    listCategoriasConhecidas(),
    // Meses que têm linha revisável, para o seletor (sem filtro: o seletor sempre mostra todas as opções).
    prisma.revenueCategorizedLine.groupBy({
      by: ["mesCredito"],
      where: { proporcionado: { in: ["S", "SEM_LV"] }, valorRecebidoCat: { not: 0 }, mesCredito: { not: "0000-00" } },
      orderBy: { mesCredito: "desc" },
    }),
  ]);

  // Se a URL pede um mês que não tem linha revisável, ele ainda aparece no seletor (selecionado), para a tela
  // não parecer ter ignorado o filtro.
  const meses = mesesBanco.map((m) => m.mesCredito);
  if (filtros.mes && !meses.includes(filtros.mes)) meses.unshift(filtros.mes);

  const linhas: LinhaRevisao[] = linhasRaw.map((l) => ({
    id: l.id,
    crConexaId: l.crConexaId,
    razaoSocial: l.razaoSocial,
    servicoOuPlano: l.servicoOuPlano,
    categoria: l.categoria,
    proporcionado: l.proporcionado,
    valorRecebidoCat: l.valorRecebidoCat.toString(),
    revisadoManualmente: l.revisadoManualmente,
    revisadoPorNome: l.revisadoPor?.name ?? null,
    revisadoEm: l.revisadoEm?.toISOString() ?? null,
    categoriaOriginal: l.categoriaOriginal,
    valorRecebidoCatOriginal: l.valorRecebidoCatOriginal?.toString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo={"Revisar"} descricao={"Faturas rateadas ou sem correspondência no Listar Vendas."} dica={"Todas as faturas rateadas (\"S\") ou sem correspondência no Listar Vendas (\"Sem LV\") do sistema, sempre atuais — não escopadas a uma rodada específica. Linhas com valor R$ 0,00 não entram na fila."} />

      <Card className="overflow-x-auto">
        <SectionTitle hint={`${totalPendentes} pendente(s) de revisão${temFiltroRevisao(filtros) ? " neste filtro" : ""}`}>Faturas para revisar</SectionTitle>

        {/* Filtros por GET (sem JavaScript): a URL guarda o recorte e pode ser compartilhada. */}
        <form method="get" action="/revisar" className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="filtro-mes">
              Mês de crédito
            </label>
            <select id="filtro-mes" name="mes" className="input" defaultValue={filtros.mes ?? ""}>
              <option value="">Todos os meses</option>
              {meses.map((m) => (
                <option key={m} value={m}>
                  {mesPorExtenso(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filtro-prop">
              Proporcionado
            </label>
            <select id="filtro-prop" name="proporcionado" className="input" defaultValue={filtros.proporcionado ?? ""}>
              <option value="">Todos</option>
              <option value="S">Rateadas (S)</option>
              <option value="SEM_LV">Sem Listar Vendas</option>
            </select>
          </div>
          <button type="submit" className="btn">
            Filtrar
          </button>
          {temFiltroRevisao(filtros) ? (
            <Link href="/revisar" className="pb-2 text-sm text-acento-texto hover:underline">
              Limpar filtros
            </Link>
          ) : null}
        </form>

        <p className="mb-3 text-xs text-slate-500">
          Categoria e valor aqui vêm calculados pela skill categoriza-receita. "Editar" corrige manualmente esta
          linha — a correção fica marcada e rastreada (quem, quando, valor original), e nunca é sobrescrita
          automaticamente depois, mesmo pela sincronização automática de 15 em 15 minutos.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4">CR ID</th>
              <th className="pb-2 pr-4">Cliente</th>
              <th className="pb-2 pr-4">Serviço/Plano</th>
              <th className="pb-2 pr-4">Categoria</th>
              <th className="pb-2 pr-4">Proporcionado</th>
              <th className="pb-2 pr-4">Valor Cat.</th>
              <th className="pb-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <LinhaRevisaoRow key={l.id} linha={l} categorias={categorias} />
            ))}
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  {temFiltroRevisao(filtros) ? "Nenhuma linha neste filtro." : "Nada para revisar."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {linhasRaw.length === TAKE ? (
          <p className="mt-3 text-xs text-slate-400">
            Mostrando os primeiros {TAKE} — use os filtros acima (mês e Proporcionado) para ver o restante.
          </p>
        ) : null}
        {totalZerados > 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            {totalZerados} linha(s) com valor R$ 0,00 fora da fila — não somam em nenhuma categoria, então não há o
            que revisar nelas.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
