import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchBothExports } from "@/lib/conexa-web/client";
import { readXlsxAsObjects } from "@/lib/xlsx/reader";
import { parseContasReceberRows, parseListarVendasRows } from "@/lib/categorization/parse-exports";
import { categorizeInvoices } from "@/lib/categorization/categorize-invoices";
import { STATUS_ACEITOS_CR, STATUS_ACEITOS_LV, type CategorizedLine } from "@/lib/categorization/types";
import { toAmountString } from "@/lib/money";

/**
 * Dispara uma rodada completa: baixa os dois exports do Conexa (login web,
 * ver conexa-web/client.ts), categoriza e persiste. Cria o registro da rodada
 * como RUNNING antes de qualquer chamada de rede, para que falhas parciais
 * fiquem registradas (nunca "sumam" silenciosamente).
 */
export async function startCategorizationRun(params: {
  periodoInicio: Date;
  periodoFim: Date;
  executadoPorId?: string;
}): Promise<string> {
  const run = await prisma.revenueCategorizationRun.create({
    data: {
      periodoInicio: params.periodoInicio,
      periodoFim: params.periodoFim,
      status: "RUNNING",
      executadoPorId: params.executadoPorId,
    },
  });

  try {
    const { listarVendas, contasReceber } = await fetchBothExports(params.periodoInicio, params.periodoFim);

    const crRowsAll = parseContasReceberRows(readXlsxAsObjects(contasReceber));
    const lvRowsAll = parseListarVendasRows(readXlsxAsObjects(listarVendas));

    const crRows = crRowsAll.filter((r) => STATUS_ACEITOS_CR.includes(r.status));
    const lvRows = lvRowsAll.filter((r) => STATUS_ACEITOS_LV.includes(r.status));

    const rules = await prisma.revenueCategoryRule.findMany({ where: { ativo: true } });
    const resultado = categorizeInvoices(
      crRows,
      lvRows,
      rules.map((r) => ({ nome: r.nome, categoria: r.categoria })),
    );

    await prisma.$transaction([
      prisma.revenueCategorizedLine.createMany({
        data: resultado.linhas.map((l) => toLineData(run.id, l)),
      }),
      prisma.revenueCategorizationRun.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          concluidoEm: new Date(),
          totalLinhasCR: resultado.totalLinhasCR,
          totalLinhasLV: resultado.totalLinhasLV,
          totalSemLV: resultado.totalSemLV,
          totalRecebido: toAmountString(resultado.totalRecebido),
          resumoPorCategoria: resultado.resumoPorCategoria as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return run.id;
  } catch (err) {
    await prisma.revenueCategorizationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        concluidoEm: new Date(),
        erro: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

function toLineData(runId: string, l: CategorizedLine) {
  return {
    runId,
    crConexaId: l.crId,
    unidade: l.unidade || null,
    faturamento: l.faturamento || null,
    clienteConexaId: l.clienteId,
    cpfCnpj: l.cpfCnpj || null,
    razaoSocial: l.razaoSocial || null,
    planoContratado: l.planoContratado || null,
    categoria: l.categoria,
    proporcionado: l.proporcionado,
    tipo: l.tipo || null,
    status: l.status || null,
    parcela: l.parcela || null,
    valorRecebidoCat: toAmountString(l.valorRecebidoCategoria),
    valorRecebidoTotal: toAmountString(l.valorRecebidoTotal),
    valorBruto: toAmountString(l.valorBruto),
    valorDesconto: toAmountString(l.valorDesconto),
    vencimento: l.vencimento,
    quitacao: l.quitacao,
    competencia: l.competencia,
    emissao: l.emissao,
    dataCredito: l.dataCredito,
    conta: l.conta || null,
    observacoes: l.observacoes || null,
    tags: l.tags || null,
    raw: l.raw as unknown as Prisma.InputJsonValue,
  };
}
