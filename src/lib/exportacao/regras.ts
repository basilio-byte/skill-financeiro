import "server-only";
import type { Prisma } from "@prisma/client";
import { escaparLike } from "./parametros";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import { entregarAsync } from "./empacotar";
import { descreverPedidoRegras, montarAbasRegras, nomeDoArquivoRegras, type LinhaRegra, type Pendencia, type PedidoRegras } from "./pasta-regras";
import { paraParede } from "./planilha";
import type { Formato, ResultadoExportacao, UsuarioExport } from "./tipos";

/**
 * Exportação das REGRAS DE CATEGORIA (ADR-0035), parte do servidor. Só LEITURA da tabela de regras e das linhas
 * "Sem Categoria". Os nomes saem exatamente como estão no banco (nunca normalizados).
 */
export async function gerarExportacaoRegras(pedido: PedidoRegras, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  const agora = new Date();
  const where: Prisma.RevenueCategoryRuleWhereInput = {
    ...(pedido.ativo === "ativas" ? { ativo: true } : pedido.ativo === "inativas" ? { ativo: false } : {}),
    ...(pedido.categorias.length ? { categoria: { in: pedido.categorias } } : {}),
    ...(pedido.busca ? { nome: { contains: escaparLike(pedido.busca), mode: "insensitive" as const } } : {}),
  };
  const [regrasDb, pendDb] = await Promise.all([
    prisma.revenueCategoryRule.findMany({ where, orderBy: [{ categoria: "asc" }, { nome: "asc" }] }),
    pedido.pendencias
      ? prisma.revenueCategorizedLine.groupBy({
          by: ["servicoOuPlano"],
          // servicoOuPlano vazio não é acionável (não dá para cadastrar regra para "nada"): mesma regra da tela /categorias.
          where: { categoria: "Sem Categoria", servicoOuPlano: { not: "" } },
          _count: { _all: true },
          _sum: { valorRecebidoCat: true },
          _min: { dataCredito: true },
          _max: { dataCredito: true },
          orderBy: { _sum: { valorRecebidoCat: "desc" } },
        })
      : Promise.resolve([]),
  ]);

  const regras: LinhaRegra[] = regrasDb.map((r) => ({
    nome: r.nome,
    categoria: r.categoria,
    ativo: r.ativo,
    criadoEm: paraParede(r.createdAt),
    atualizadoEm: paraParede(r.updatedAt),
  }));
  const pendencias: Pendencia[] = pendDb.map((g) => ({
    nome: g.servicoOuPlano,
    linhas: g._count._all,
    valor: g._sum.valorRecebidoCat ? g._sum.valorRecebidoCat.toFixed(2) : "0.00",
    primeiroCredito: g._min.dataCredito,
    ultimoCredito: g._max.dataCredito,
  }));

  const pasta = montarAbasRegras({ regras, pendencias, pedido, geradoEm: agora, usuario });
  const entrega = await entregarAsync(
    pasta.abas,
    [{ nomeAba: "Regras", titulos: ["Nome (Serviço/Item ou Plano Contratado)", "Categoria", "Ativa", "Criada em", "Atualizada em"], nLinhas: pasta.nLinhas, indiceValor: -1, total: null }],
    formato,
    "Regras",
  );
  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoRegras(todayKey(), entrega.extensao),
    contentType: entrega.contentType,
    linhas: pasta.nLinhas,
    total: null,
    filtros: descreverPedidoRegras(pedido),
    dadosPessoais: false,
    filtrosJson: pedido,
  };
}
