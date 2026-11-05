import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { condicao, nomeDe } from "@/lib/inadimplencia/consulta";
import { diasDeAtraso, type FiltrosInadimplencia } from "@/lib/inadimplencia/dominio";
import { money, toAmountString } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { ceder } from "./fila";
import { fraseDeFrescorInad } from "./frescor-texto";
import {
  descreverFiltrosInad,
  grupoInadPermitido,
  montarAbasInadimplencia,
  nomeDoArquivoInad,
  type LinhaInadimplencia,
  type PedidoInadimplencia,
} from "./pasta-inadimplencia";
import { paraParede } from "./planilha";
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
 * Exportação de INADIMPLENTES (ADR-0035), parte do servidor: lê o espelho `cobrancas_em_aberto` com o MESMO filtro da
 * tela (`condicao`), numa transação REPEATABLE READ, e entrega o arquivo conferido. Só LEITURA — nada aqui escreve no
 * espelho nem encosta na receita (ADR-0031: são mundos separados).
 */

const TAM_LOTE = 2000;

function ordenacao(f: FiltrosInadimplencia): Prisma.CobrancaEmAbertoOrderByWithRelationInput[] {
  // Desempate por id: sem ele, valores iguais trocam de lugar entre lotes (a mesma razão da tela).
  return [f.ordem === "valor" ? { valor: f.direcao } : { vencimento: f.direcao }, { conexaId: "asc" }];
}

export function validarPermissoesInadimplencia(pedido: PedidoInadimplencia, usuario: UsuarioExport): void {
  for (const g of pedido.grupos) {
    if (!grupoInadPermitido(g, usuario.papel)) {
      throw new ExportacaoNegadaError(
        g === "contato"
          ? "Telefone e e-mail dos clientes (dados pessoais) só podem ser exportados por administradores."
          : `O grupo de colunas "${g}" não está disponível para o seu perfil.`,
      );
    }
  }
}

export async function gerarExportacaoInadimplencia(pedido: PedidoInadimplencia, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  validarPermissoesInadimplencia(pedido, usuario);
  const f = pedido.filtros;
  const agora = new Date();
  const hojeKey = todayKey();
  const hoje = keyToUtcDate(hojeKey);
  const where = condicao(f);
  const comContato = pedido.grupos.includes("contato");

  const leitura = await prisma.$transaction(
    async (tx) => {
      const contagem = await tx.cobrancaEmAberto.count({ where });
      if (contagem > MAX_LINHAS) {
        throw new ExportacaoGrandeDemaisError(`O recorte tem ${contagem.toLocaleString("pt-BR")} cobranças e o máximo por exportação é ${MAX_LINHAS.toLocaleString("pt-BR")}. Acrescente filtros.`);
      }
      const soma = await tx.cobrancaEmAberto.aggregate({ where, _sum: { valor: true } });
      const linhas: LinhaInadimplencia[] = [];
      for (let skip = 0; skip < contagem; skip += TAM_LOTE) {
        const lote = await tx.cobrancaEmAberto.findMany({
          where,
          orderBy: ordenacao(f),
          skip,
          take: TAM_LOTE,
          select: {
            conexaId: true,
            customerConexaId: true,
            clienteNome: true,
            clienteFantasia: true,
            unidade: true,
            status: true,
            tipo: true,
            valor: true,
            valorOriginal: true,
            vencimento: true,
            competencia: true,
            atualizadoNoConexa: true,
            sincronizadoEm: true,
            ...(comContato ? { telefone: true, email: true } : {}),
          },
        });
        for (const r of lote as Array<typeof lote[number] & { telefone?: string | null; email?: string | null }>) {
          linhas.push({
            conexaId: r.conexaId,
            customerConexaId: r.customerConexaId,
            cliente: nomeDe(r.clienteNome, r.clienteFantasia, r.customerConexaId),
            unidade: r.unidade,
            status: r.status,
            tipo: r.tipo,
            valor: r.valor.toFixed(2),
            valorOriginal: r.valorOriginal.toFixed(2),
            vencimento: r.vencimento,
            competencia: r.competencia,
            diasDeAtraso: diasDeAtraso(r.vencimento, hoje),
            atualizadoNoConexa: r.atualizadoNoConexa ? paraParede(r.atualizadoNoConexa) : null,
            sincronizadoEm: paraParede(r.sincronizadoEm),
            telefone: r.telefone ?? null,
            email: r.email ?? null,
          });
        }
      }
      const ultima = await tx.inadimplenciaSyncRun.findFirst({ orderBy: { iniciadoEm: "desc" }, select: { iniciadoEm: true, concluidoEm: true, status: true, erro: true } });
      return { linhas, contagem, totalBanco: toAmountString(money(soma._sum.valor?.toString() ?? "0")), ultima };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
  await ceder();

  // 1ª conferência: o que está em memória bate com o que o banco soma pelo mesmo filtro?
  const somaLinhas = toAmountString(leitura.linhas.reduce((a, l) => a.plus(money(l.valor)), money(0)));
  const problemas: string[] = [];
  if (leitura.linhas.length !== leitura.contagem) problemas.push(`cobranças lidas (${leitura.linhas.length}) ≠ contagem do banco (${leitura.contagem})`);
  if (somaLinhas !== leitura.totalBanco) problemas.push(`soma das cobranças (${somaLinhas}) ≠ soma do banco (${leitura.totalBanco})`);
  if (problemas.length) throw new ExportacaoInconsistenteError(`Conferência com o banco não fechou — o arquivo não foi entregue. ${problemas.join("; ")}.`);

  const frescor = fraseDeFrescorInad(
    { em: leitura.ultima ? (leitura.ultima.concluidoEm ?? leitura.ultima.iniciadoEm) : null, status: leitura.ultima?.status ?? null, erro: leitura.ultima?.erro ?? null },
    agora,
    usuario.papel === "ADMIN",
  );
  const pasta = montarAbasInadimplencia({ linhas: leitura.linhas, pedido, geradoEm: agora, usuario, frescor, hoje: hojeKey });
  await ceder();
  // 2ª conferência: o arquivo escrito (xlsx ou csv), relido.
  const total = toAmountString(pasta.total);
  const entrega = await entregarAsync(
    pasta.abas,
    [{ nomeAba: "Por cobrança", titulos: pasta.titulosDasColunas, nLinhas: leitura.linhas.length, indiceValor: pasta.detalhe.indiceColunaTotal, total }],
    formato,
    "Por cobrança",
  );

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoInad(f, hojeKey, entrega.extensao),
    contentType: entrega.contentType,
    linhas: leitura.linhas.length,
    total,
    filtros: descreverFiltrosInad(f),
    dadosPessoais: comContato,
    filtrosJson: { ...pedido, filtros: { ...f, de: f.de?.toISOString().slice(0, 10) ?? null, ate: f.ate?.toISOString().slice(0, 10) ?? null } },
  };
}

