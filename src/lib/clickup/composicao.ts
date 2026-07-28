import "server-only";
import type { ClickUpVinculo, Proporcionado } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, roundMoney, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import type { ItemDaLinha } from "@/lib/categorization/types";
import {
  bateAlgumPadrao,
  donoDoItem,
  particionarPorReivindicacao,
  type VinculoAtivo,
} from "@/lib/clickup/filtro-padroes";

/**
 * COMPOSIÇÃO de um vínculo num período: exatamente quais linhas de receita
 * somam o valor que vai (ou foi) pro campo de mês da tarefa no ClickUp.
 *
 * Este módulo é a FONTE ÚNICA dessa resposta — `push.ts` (que empurra o valor)
 * e `detalharVinculoAction` (que mostra a lista na tela admin) chamam a MESMA
 * função. Isso não é preciosismo: o `ClickUpPushLog` guarda só o total, nunca
 * quais linhas o compuseram, então a lista da tela é sempre um RECÁLCULO. Se
 * ela reimplementasse o filtro — mesmo "quase igual" — a soma exibida
 * divergiria do valor empurrado e a tela mentiria sobre dinheiro.
 *
 * DOIS MODOS DE ATRIBUIÇÃO (ADR-0028):
 *
 *  - `por-item` (preferido): a linha tem `itensDetalhe`, então cada item vai
 *    pro vínculo que casa o padrão DELE. Uma fatura com 3 salas divide o valor
 *    entre as 3 tarefas, cada uma recebendo o que de fato faturou.
 *  - `linha-inteira` (fallback): linha SEM detalhe por item — gravada antes da
 *    ADR-0028, ou fatura sem LV casado (`SEM_LV`), ou linha revisada
 *    manualmente (ver abaixo). Aí vale a regra antiga: o vínculo ATIVO mais
 *    antigo que casar leva a linha inteira, os outros excluem. É grosseiro
 *    (credita receita à sala errada quando a fatura combina salas), mas é o
 *    melhor possível sem o detalhe — e nunca duplica dinheiro.
 *
 * Por que linha revisada manualmente NÃO usa os itens: uma revisão pode ter
 * trocado `valorRecebidoCat` à mão, e nesse caso a soma dos itens (que veio do
 * motor) deixa de bater com o número que um humano corrigiu de propósito.
 * Respeitar a correção humana é regra permanente do projeto (financial-rigor
 * #9), então a linha inteira segue o valor revisado.
 */

/** Campos exibidos na tela de detalhamento. Serializáveis: valor vira string, nunca Decimal. */
export interface LinhaDaComposicao {
  id: string;
  /** ID da fatura no Conexa (Contas a Receber) — o mais próximo de "número da fatura". */
  crConexaId: number;
  razaoSocial: string | null;
  servicoOuPlano: string;
  dataCredito: string | null;
  /** Valor TOTAL da linha na categoria (a fatura inteira naquele bucket). */
  valorRecebidoCat: string;
  /** Quanto DESTA linha soma para ESTE vínculo — igual a `valorRecebidoCat` no modo linha-inteira. */
  valorAtribuido: string;
  modo: "por-item" | "linha-inteira";
  /**
   * A fatura foi REPARTIDA (este vínculo levou só uma parte)? Decidido aqui,
   * com comparação de Decimal — nunca na UI comparando strings. O Decimal do
   * Prisma derruba zeros à direita ("250.00" vira "250"), então comparar texto
   * marcava como dividida toda mensalidade redonda que na verdade foi integral
   * (achado da revisão adversarial 2026-07-28). Manter a decisão aqui elimina
   * a classe do bug em vez de só consertar a ocorrência.
   */
  dividida: boolean;
  /** No modo por-item: quais itens desta linha pertencem a este vínculo. */
  itensAtribuidos?: Array<{ servicoItem: string; valor: string }>;
  /** "S" = valor rateado entre categorias da mesma fatura; explica valor menor que o da fatura. */
  proporcionado: Proporcionado;
  revisadoManualmente: boolean;
}

export interface LinhaExcluidaDaComposicao extends LinhaDaComposicao {
  /** Tarefa do ClickUp que ficou com a linha (modo linha-inteira) ou com o primeiro item (por-item). */
  reivindicadaPorTaskId: string;
  /**
   * Só no modo por-item: como a linha foi de fato REPARTIDA entre os vínculos.
   * Sem isso a tela diria "R$ 123,75 somando na tarefa X" quando X levou só
   * R$ 26,25 — a fatura foi dividida entre várias tarefas, não entregue a uma.
   */
  repartidaEntre?: Array<{ servicoItem: string; valor: string; taskId: string }>;
}

export interface ComposicaoDoVinculo {
  incluidas: LinhaDaComposicao[];
  excluidas: LinhaExcluidaDaComposicao[];
  /** Soma de `valorAtribuido` das incluídas — Decimal.js, arredondado UMA vez no fim. */
  total: Money;
}

const comoVinculoAtivo = (v: ClickUpVinculo): VinculoAtivo => ({
  id: v.id,
  clickUpTaskId: v.clickUpTaskId,
  padroes: v.padroes as string[],
  criadoEm: v.criadoEm,
});

/** Linha vinda do banco, no formato mínimo que a composição precisa. */
interface LinhaCrua {
  id: string;
  crConexaId: number;
  razaoSocial: string | null;
  servicoOuPlano: string;
  dataCredito: Date | null;
  valorRecebidoCat: { toString(): string };
  ajusteArredondamento: { toString(): string } | null;
  itensDetalhe: unknown;
  proporcionado: Proporcionado;
  revisadoManualmente: boolean;
}

function itensDaLinha(linha: LinhaCrua): ItemDaLinha[] | null {
  // Revisão manual congela o valor da linha: os itens do motor podem não somar
  // mais o que o humano gravou, então não são usados (ver doc do módulo).
  if (linha.revisadoManualmente) return null;
  const bruto = linha.itensDetalhe;
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  return bruto as ItemDaLinha[];
}

export async function composicaoDoVinculo(
  vinculo: ClickUpVinculo,
  outrosAtivosDaMesmaCategoria: ClickUpVinculo[],
  fromDate: Date,
  toDateExclusive: Date,
): Promise<ComposicaoDoVinculo> {
  const padroes = vinculo.padroes as string[];
  const atual = comoVinculoAtivo(vinculo);
  const outros = outrosAtivosDaMesmaCategoria.map(comoVinculoAtivo);
  // Candidatos a dono de um item: TODOS os vínculos ativos da categoria,
  // incluindo o atual — a decisão é "de quem é este item", não "é meu?".
  const candidatos = [atual, ...outros];

  const linhas = (await prisma.revenueCategorizedLine.findMany({
    where: { categoria: vinculo.categoria, dataCredito: { gte: fromDate, lt: toDateExclusive } },
    select: {
      id: true,
      crConexaId: true,
      razaoSocial: true,
      servicoOuPlano: true,
      dataCredito: true,
      valorRecebidoCat: true,
      ajusteArredondamento: true,
      itensDetalhe: true,
      proporcionado: true,
      revisadoManualmente: true,
    },
    orderBy: [{ dataCredito: "asc" }, { crConexaId: "asc" }],
  })) as unknown as LinhaCrua[];

  const base = (l: LinhaCrua) => ({
    id: l.id,
    crConexaId: l.crConexaId,
    razaoSocial: l.razaoSocial,
    servicoOuPlano: l.servicoOuPlano,
    dataCredito: l.dataCredito ? l.dataCredito.toISOString() : null,
    // `toAmountString` e não `.toString()`: o Decimal do Prisma derruba zeros à
    // direita ("250.00" vira "250"), e a UI compara este valor com
    // `valorAtribuido` (que é sempre toFixed(2)) pra saber se a linha foi
    // dividida. Sem normalizar, toda mensalidade redonda parecia dividida
    // (achado da revisão adversarial 2026-07-28).
    valorRecebidoCat: toAmountString(money(l.valorRecebidoCat.toString())),
    proporcionado: l.proporcionado,
    revisadoManualmente: l.revisadoManualmente,
  });

  const incluidas: LinhaDaComposicao[] = [];
  const excluidas: LinhaExcluidaDaComposicao[] = [];
  const semItens: LinhaCrua[] = [];

  for (const linha of linhas) {
    const itens = itensDaLinha(linha);
    if (!itens) {
      semItens.push(linha);
      continue;
    }

    // Modo por-item: cada item vai pro seu dono.
    const meus: Array<{ servicoItem: string; valor: string }> = [];
    let valor = ZERO;
    let donoDoPrimeiroItemAtribuido: VinculoAtivo | null = null;
    for (const item of itens) {
      const dono = donoDoItem(item.servicoItem, candidatos);
      if (!dono) continue; // item de nenhum vínculo: valor não é espelhado (correto)
      if (donoDoPrimeiroItemAtribuido === null) donoDoPrimeiroItemAtribuido = dono;
      if (dono.id !== atual.id) continue;
      meus.push({ servicoItem: item.servicoItem, valor: item.valorRateado });
      valor = valor.plus(money(item.valorRateado));
    }

    if (meus.length === 0) {
      // Nenhum item meu. Só reporto como "excluída" se a linha ao menos casa
      // meus padrões (senão ela nunca foi minha e viraria ruído na tela).
      if (bateAlgumPadrao(linha.servicoOuPlano, padroes) && donoDoPrimeiroItemAtribuido) {
        excluidas.push({
          ...base(linha),
          valorAtribuido: toAmountString(ZERO),
          modo: "por-item",
          dividida: true,
          reivindicadaPorTaskId: donoDoPrimeiroItemAtribuido.clickUpTaskId,
          // No modo por-item a linha foi REPARTIDA entre vários vínculos — não
          // existe "um" dono do valor cheio. Mandar a divisão real pra tela
          // evita dizer "R$ 123,75 somando em t-cabine" quando a Cabine levou
          // R$ 26,25 (achado da revisão adversarial 2026-07-28).
          repartidaEntre: itens
            .map((it) => ({ servicoItem: it.servicoItem, valor: it.valorRateado, dono: donoDoItem(it.servicoItem, candidatos) }))
            .filter((d) => d.dono !== null)
            .map((d) => ({ servicoItem: d.servicoItem, valor: d.valor, taskId: d.dono!.clickUpTaskId })),
        });
      }
      continue;
    }

    // O resíduo de centavos da fatura não é atribuível a item nenhum — vai pro
    // dono do PRIMEIRO item atribuído (determinístico). Quando a linha não é
    // dividida, isso devolve exatamente `valorRecebidoCat`, igual ao de antes.
    if (donoDoPrimeiroItemAtribuido?.id === atual.id && linha.ajusteArredondamento) {
      valor = valor.plus(money(linha.ajusteArredondamento.toString()));
    }

    const atribuido = roundMoney(valor);
    incluidas.push({
      ...base(linha),
      valorAtribuido: toAmountString(atribuido),
      modo: "por-item",
      dividida: !atribuido.equals(money(linha.valorRecebidoCat.toString())),
      itensAtribuidos: meus,
    });
  }

  // Fallback para as linhas sem detalhe por item: regra antiga, linha inteira
  // pro vínculo ativo mais antigo que casar.
  const queBatem = semItens.filter((l) => bateAlgumPadrao(l.servicoOuPlano, padroes));
  const particao = particionarPorReivindicacao(queBatem, atual, outros);
  for (const l of particao.incluidas) {
    incluidas.push({
      ...base(l),
      valorAtribuido: toAmountString(money(l.valorRecebidoCat.toString())),
      modo: "linha-inteira",
      dividida: false, // "linha-inteira" significa exatamente isto: sem repartição
    });
  }
  for (const e of particao.excluidas) {
    excluidas.push({
      ...base(e.linha),
      valorAtribuido: toAmountString(ZERO),
      modo: "linha-inteira",
      dividida: false,
      reivindicadaPorTaskId: e.reivindicadaPor.clickUpTaskId,
    });
  }

  // Arredondamento UMA vez no fim — nunca linha a linha (financial-rigor.md).
  const total = roundMoney(sum(incluidas.map((l) => l.valorAtribuido)));
  return { incluidas, excluidas, total };
}
