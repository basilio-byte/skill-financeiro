import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import { money, toAmountString, type Money } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { camposNecessarios, colunasDosGrupos, grupoPermitido, temDadosPessoais, type LinhaReceita } from "./colunas-receita";
import { conferirContraBanco } from "./conferencia";
import { entregarAsync } from "./empacotar";
import { descreverFiltros, filtrosParaWhere, nomeDoArquivoReceita, periodoEfetivo, type FiltrosReceita } from "./filtros-receita";
import { ceder } from "./fila";
import { frescorDaReceita } from "./frescor";
import { montarAbasReceita } from "./pasta-receita";
import { paraLinhaReceita, selecao, type RowBruto } from "./mapeamento-receita";
import {
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoNegadaError,
  MAX_LINHAS,
  type Formato,
  type ResultadoExportacao,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação de RECEITA (ADR-0035): lê o banco, monta a pasta de trabalho, CONFERE e devolve o arquivo.
 *
 * Só LEITURA — nada aqui escreve em receita, metas ou sincronização. A leitura roda numa transação REPEATABLE READ
 * (Postgres/MVCC): contagem, soma, soma por categoria e as linhas vêm do MESMO instante, mesmo que a sincronização de
 * 15 minutos atualize linhas no meio — e, por ser leitura, não bloqueia a sincronização nem é bloqueada por ela.
 *
 * Consumo de recursos (o mesmo processo serve o painel): só as COLUNAS dos grupos escolhidos são lidas do banco, em
 * LOTES, e cada lote vira texto simples na hora — ler 24 mil linhas × 33 colunas de uma vez custava ~240 MB e 4 s só
 * para o Prisma criar um objeto Decimal por coluna de dinheiro.
 */

/** Linhas por lote de leitura. */
const TAM_LOTE = 2000;

export interface LeituraReceita {
  linhas: LinhaReceita[];
  contagem: number;
  total: string;
  porCategoria: Map<string, string>;
  semDataCredito: number;
}

async function lerDoBanco(f: FiltrosReceita, campos: ReadonlySet<string>): Promise<LeituraReceita> {
  const where = filtrosParaWhere(f);
  const select = selecao(campos);
  return prisma.$transaction(
    async (tx) => {
      const contagem = await tx.revenueCategorizedLine.count({ where });
      if (contagem > MAX_LINHAS) {
        throw new ExportacaoGrandeDemaisError(
          `O recorte tem ${contagem.toLocaleString("pt-BR")} linhas e o máximo por exportação é ${MAX_LINHAS.toLocaleString("pt-BR")}. ` +
            "Reduza o período ou acrescente filtros (unidade, conta, categoria…).",
        );
      }
      const soma = await tx.revenueCategorizedLine.aggregate({ where, _sum: { valorRecebidoCat: true } });
      const porCat = await tx.revenueCategorizedLine.groupBy({ by: ["categoria"], where, _sum: { valorRecebidoCat: true } });

      // Em lotes, e cada lote vira texto simples na hora (os objetos Decimal do Prisma morrem aqui). A ordem inclui a
      // chave única completa (fatura, linha, mês) para os lotes nunca repetirem nem pularem uma linha.
      const linhas: LinhaReceita[] = [];
      for (let skip = 0; skip < contagem; skip += TAM_LOTE) {
        const lote = await tx.revenueCategorizedLine.findMany({
          where,
          select,
          orderBy: [{ dataCredito: "asc" }, { crConexaId: "asc" }, { chaveLinha: "asc" }, { mesCredito: "asc" }],
          skip,
          take: TAM_LOTE,
        });
        for (const r of lote) linhas.push(paraLinhaReceita(r as unknown as RowBruto));
      }
      const semDataCredito = await tx.revenueCategorizedLine.count({ where: { dataCredito: null } });
      return {
        linhas,
        contagem,
        total: toAmountString(money(soma._sum.valorRecebidoCat?.toString() ?? "0")),
        porCategoria: new Map(porCat.map((g) => [g.categoria, toAmountString(money(g._sum.valorRecebidoCat?.toString() ?? "0"))])),
        semDataCredito,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
}

/** Verificações de permissão que valem ANTES de ler qualquer dado. */
export function validarPermissoesReceita(f: FiltrosReceita, usuario: UsuarioExport): void {
  for (const g of f.grupos) {
    if (!grupoPermitido(g, usuario.papel)) {
      throw new ExportacaoNegadaError(
        g === "sensiveis"
          ? "Dados pessoais e texto livre (CPF/CNPJ, observações) só podem ser exportados por administradores."
          : `O grupo de colunas "${g}" não está disponível para o seu perfil.`,
      );
    }
  }
}

export interface OpcoesGeracao {
  /** Formato de saída (padrão: xlsx). No CSV só o detalhe sai (ver csv.ts). */
  formato?: Formato;
  /** Campos extras que as abas extras precisam ler (ex.: itensDetalhe). */
  camposExtras?: readonly string[];
  /** Abas extras já montadas (ex.: Itens), a partir das linhas lidas; `soma` é conferida contra o total do detalhe. */
  extras?: (linhas: LinhaReceita[]) => Array<{ aba: Sheet; soma?: Money; aviso?: string }>;
}

export async function gerarExportacaoReceita(f: FiltrosReceita, usuario: UsuarioExport, opcoes: OpcoesGeracao = {}): Promise<ResultadoExportacao> {
  validarPermissoesReceita(f, usuario);
  const agora = new Date();
  const campos = camposNecessarios(colunasDosGrupos(f.grupos), opcoes.camposExtras ?? []);
  const [leitura, frescor] = await Promise.all([lerDoBanco(f, campos), frescorDaReceita(agora)]);
  const linhas = leitura.linhas;
  await ceder();

  // 1ª conferência: o que está em memória bate com o que o BANCO soma pelo mesmo filtro?
  const doBanco = conferirContraBanco(linhas, { contagem: leitura.contagem, total: leitura.total, porCategoria: leitura.porCategoria });
  if (doBanco.length) {
    throw new ExportacaoInconsistenteError(`Conferência com o banco não fechou — o arquivo não foi entregue. ${doBanco.join("; ")}.`);
  }

  const pasta = montarAbasReceita({
    linhas,
    // O CSV leva só o detalhe: não monta resumos que ninguém vai ler.
    filtros: opcoes.formato === "csv" ? { ...f, resumos: false } : f,
    geradoEm: agora,
    usuario,
    frescor: { texto: frescor.texto, alerta: frescor.alerta },
    semDataCreditoNoBanco: leitura.semDataCredito,
    hoje: todayKey(),
    extras: opcoes.extras?.(linhas),
  });
  await ceder();
  await ceder();

  // 2ª conferência: o ARQUIVO escrito (xlsx ou csv), lido de volta, tem as mesmas linhas e a mesma soma?
  const total = toAmountString(pasta.total);
  const entrega = await entregarAsync(
    pasta.abas,
    [{ nomeAba: "Cobranças", titulos: pasta.titulosDasColunas, nLinhas: linhas.length, indiceValor: pasta.detalhe.indiceColunaTotal, total }],
    opcoes.formato ?? "xlsx",
    "Cobranças",
  );

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoReceita(f, entrega.extensao),
    contentType: entrega.contentType,
    linhas: linhas.length,
    total,
    filtros: descreverFiltros(f),
    dadosPessoais: temDadosPessoais(f.grupos),
    filtrosJson: f,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Prévia (tela): o que ESTE recorte vai entregar, antes de baixar
// ---------------------------------------------------------------------------------------------------------------

export interface PreviaReceita {
  linhas: number;
  faturas: number;
  total: string;
  semCategoriaLinhas: number;
  semCategoriaValor: string;
  revisadas: number;
  /** Passou do teto de linhas por exportação? */
  passaDoTeto: boolean;
  /** O período alcança hoje (ou não tem limite): há mês em andamento. */
  incluiHoje: boolean;
  menorData: string | null;
  maiorData: string | null;
}

export async function previaReceita(f: FiltrosReceita): Promise<PreviaReceita> {
  const where = filtrosParaWhere(f);
  const [agg, porFatura, semCat, revisadas, menor, maior] = await prisma.$transaction(
    [
      prisma.revenueCategorizedLine.aggregate({ where, _sum: { valorRecebidoCat: true }, _count: { _all: true } }),
      // (o Prisma exige `orderBy` no groupBy dentro de $transaction em lote)
      prisma.revenueCategorizedLine.groupBy({ by: ["crConexaId"], where, orderBy: { crConexaId: "asc" } }),
      prisma.revenueCategorizedLine.aggregate({ where: { AND: [where, { categoria: "Sem Categoria" }] }, _sum: { valorRecebidoCat: true }, _count: { _all: true } }),
      prisma.revenueCategorizedLine.count({ where: { AND: [where, { revisadoManualmente: true }] } }),
      prisma.revenueCategorizedLine.findFirst({ where: { AND: [where, { dataCredito: { not: null } }] }, orderBy: { dataCredito: "asc" }, select: { dataCredito: true } }),
      prisma.revenueCategorizedLine.findFirst({ where: { AND: [where, { dataCredito: { not: null } }] }, orderBy: { dataCredito: "desc" }, select: { dataCredito: true } }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const { de, ate } = periodoEfetivo(f);
  const hoje = todayKey();
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    linhas: agg._count._all,
    faturas: porFatura.length,
    total: toAmountString(money(agg._sum.valorRecebidoCat?.toString() ?? "0")),
    semCategoriaLinhas: semCat._count._all,
    semCategoriaValor: toAmountString(money(semCat._sum.valorRecebidoCat?.toString() ?? "0")),
    revisadas,
    passaDoTeto: agg._count._all > MAX_LINHAS,
    incluiHoje: (!de || de <= hoje) && (!ate || ate >= hoje),
    menorData: iso(menor?.dataCredito),
    maiorData: iso(maior?.dataCredito),
  };
}
