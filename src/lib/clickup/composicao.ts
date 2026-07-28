import "server-only";
import type { ClickUpVinculo, Proporcionado } from "@prisma/client";
import { prisma } from "@/lib/db";
import { roundMoney, sum, type Money } from "@/lib/money";
import { bateAlgumPadrao, particionarPorReivindicacao, type VinculoAtivo } from "@/lib/clickup/filtro-padroes";

/**
 * COMPOSIÇÃO de um vínculo num período: exatamente quais linhas de receita
 * somam o valor que vai (ou foi) pro campo de mês da tarefa no ClickUp.
 *
 * Este módulo é a FONTE ÚNICA dessa resposta — `push.ts` (que empurra o valor)
 * e `detalharVinculoAction` (que mostra a lista na tela admin) chamam a MESMA
 * função. Isso não é preciosismo: o `ClickUpPushLog` guarda só o total, nunca
 * quais linhas o compuseram (não existe tabela de itens), então a lista da tela
 * é sempre um RECÁLCULO. Se ela reimplementasse o filtro — mesmo "quase igual"
 * — a soma exibida divergiria do valor empurrado e a tela mentiria sobre
 * dinheiro. Com uma implementação só, divergir vira impossível por construção.
 *
 * Os 4 filtros que definem a composição (todos obrigatórios, nesta ordem):
 *  1. `categoria` EXATA (string idêntica, sensível a acento/caixa/espaçamento —
 *     o projeto tem grafias concorrentes vivas da mesma categoria, ADR-0017);
 *  2. `dataCredito` dentro do mês, intervalo meio-aberto [início, próximo mês);
 *  3. `bateAlgumPadrao` em JS (ignora acento/caixa/espaço repetido — Postgres
 *     não faz isso sozinho, ADR-0024);
 *  4. exclusão de linhas já reivindicadas por um vínculo IRMÃO mais antigo
 *     (fatura combinando várias salas — sem isso o mesmo dinheiro somaria em
 *     dois vínculos, ADR-0025).
 */

/** Campos exibidos na tela de detalhamento. Serializáveis: valor vira string, nunca Decimal. */
export interface LinhaDaComposicao {
  id: string;
  /** ID da fatura no Conexa (Contas a Receber) — o mais próximo de "número da fatura". */
  crConexaId: number;
  razaoSocial: string | null;
  servicoOuPlano: string;
  dataCredito: string | null;
  /** É ESTE o valor somado — nunca `valorRecebidoTotal` (que é a fatura inteira). */
  valorRecebidoCat: string;
  /** "S" = valor rateado entre categorias da mesma fatura; explica valor menor que o da fatura. */
  proporcionado: Proporcionado;
  revisadoManualmente: boolean;
}

export interface LinhaExcluidaDaComposicao extends LinhaDaComposicao {
  /** Tarefa do ClickUp do vínculo mais antigo que ficou com esta linha. */
  reivindicadaPorTaskId: string;
}

export interface ComposicaoDoVinculo {
  incluidas: LinhaDaComposicao[];
  excluidas: LinhaExcluidaDaComposicao[];
  /** Soma de `incluidas` — Decimal.js, arredondado UMA vez no fim (igual ao push). */
  total: Money;
}

export async function composicaoDoVinculo(
  vinculo: ClickUpVinculo,
  outrosAtivosDaMesmaCategoria: ClickUpVinculo[],
  fromDate: Date,
  toDateExclusive: Date,
): Promise<ComposicaoDoVinculo> {
  const padroes = vinculo.padroes as string[];

  // Busca só por categoria+data no Postgres; o casamento por padrão acontece em
  // JS logo abaixo (ver doc do módulo, filtro 3).
  const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
    where: { categoria: vinculo.categoria, dataCredito: { gte: fromDate, lt: toDateExclusive } },
    select: {
      id: true,
      crConexaId: true,
      razaoSocial: true,
      servicoOuPlano: true,
      dataCredito: true,
      valorRecebidoCat: true,
      proporcionado: true,
      revisadoManualmente: true,
    },
    orderBy: [{ dataCredito: "asc" }, { crConexaId: "asc" }],
  });
  const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, padroes));

  const comoVinculoAtivo = (v: ClickUpVinculo): VinculoAtivo => ({
    id: v.id,
    clickUpTaskId: v.clickUpTaskId,
    padroes: v.padroes as string[],
    criadoEm: v.criadoEm,
  });
  const { incluidas, excluidas } = particionarPorReivindicacao(
    linhasQueBatem,
    comoVinculoAtivo(vinculo),
    outrosAtivosDaMesmaCategoria.map(comoVinculoAtivo),
  );

  // O total sai das linhas INCLUÍDAS, com Decimal.js e arredondamento uma única
  // vez no fim — nunca `Number`, nunca linha a linha (financial-rigor.md).
  const total = roundMoney(sum(incluidas.map((l) => l.valorRecebidoCat)));

  const serializar = (l: (typeof incluidas)[number]): LinhaDaComposicao => ({
    id: l.id,
    crConexaId: l.crConexaId,
    razaoSocial: l.razaoSocial,
    servicoOuPlano: l.servicoOuPlano,
    dataCredito: l.dataCredito ? l.dataCredito.toISOString() : null,
    valorRecebidoCat: l.valorRecebidoCat.toString(),
    proporcionado: l.proporcionado,
    revisadoManualmente: l.revisadoManualmente,
  });

  return {
    incluidas: incluidas.map(serializar),
    excluidas: excluidas.map((e) => ({ ...serializar(e.linha), reivindicadaPorTaskId: e.reivindicadaPor.clickUpTaskId })),
    total,
  };
}
