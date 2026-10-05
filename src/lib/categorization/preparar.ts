import { nowInAppTz } from "@/lib/dates";
import { readXlsxAsObjects } from "@/lib/xlsx/reader";
import { parseContasReceberRows, parseListarVendasRows } from "@/lib/categorization/parse-exports";
import { categorizeInvoices } from "@/lib/categorization/categorize-invoices";
import { statusAceitoCR, STATUS_ACEITOS_LV } from "@/lib/categorization/types";
import type { CategorizationRunResult, ContasReceberRow, ListarVendasRow } from "@/lib/categorization/types";
import type { CategoryRule } from "@/lib/categorization/rules";
import { roundMoney, sum, type Money } from "@/lib/money";

export interface RodadaPreparada {
  /** CR lidas do arquivo, antes de qualquer filtro. */
  crRowsAll: ContasReceberRow[];
  /** LV lidas do arquivo, antes de qualquer filtro. */
  lvRowsAll: ListarVendasRow[];
  /** CR aceitas: status aceito E alguma Data Crédito dentro do período. */
  crRows: ContasReceberRow[];
  lvRows: ListarVendasRow[];
  resultado: CategorizationRunResult;
  /** Soma de "Valor Recebido" do CR aceito — a conferência exigida pela skill (ADR-0018). */
  somaValorRecebidoCR: Money;
  /** `somaValorRecebidoCR` − total categorizado. Deve ser ZERO; diferente disso é sinal estrutural. */
  diferencaConferencia: Money;
  /** Fim do período usado para ACEITAR datas (nunca além de hoje). */
  periodoFimEfetivo: Date;
}

/**
 * Do par de planilhas do Conexa até o resultado categorizado — SEM efeitos
 * (nada de banco, nada de rede). É a primeira metade de uma rodada.
 *
 * Extraída de `startCategorizationRun` para que a rodada automática (que baixa os
 * arquivos) e a IMPORTAÇÃO MANUAL (que recebe os arquivos de uma pessoa) passem
 * pelo MESMO código, e a prévia da importação mostre exatamente o que a rodada
 * real gravaria. Mover o código para cá não mudou nenhuma regra.
 */
export function prepararRodada(params: {
  contasReceber: Buffer;
  listarVendas: Buffer;
  periodoInicio: Date;
  periodoFim: Date;
  rules: CategoryRule[];
  agora?: Date;
}): RodadaPreparada {
  // Achado real (2026-07-24): uma sincronização MANUAL pediu período até
  // 31/07 quando "hoje" ainda era 23/07 — "Data Crédito" é uma LISTA de
  // datas em faturas recorrentes (Contratual), e a regra de aceitação
  // ("qualquer data da lista que caia no período", fidelidade ao Python,
  // ADR-0018/0019) aceitou uma data agendada pro futuro (ainda não
  // realizada) como se já fosse dinheiro recebido — 28 faturas, R$6.029,12.
  // "Data Crédito" só faz sentido no passado/presente: nunca aceitar uma
  // data além de HOJE de verdade, não importa qual período foi pedido (nem
  // o automático — que nunca pede além de agora por construção — nem um
  // manual/API que peça um período mal calculado). O fetch em si pode ser
  // mais largo que isso (inofensivo); só a ACEITAÇÃO da data é limitada.
  const agora = params.agora ?? nowInAppTz();
  const periodoFimEfetivo = params.periodoFim.getTime() < agora.getTime() ? params.periodoFim : agora;

  const crRowsAll = parseContasReceberRows(
    readXlsxAsObjects(params.contasReceber),
    params.periodoInicio,
    periodoFimEfetivo,
  );
  const lvRowsAll = parseListarVendasRows(readXlsxAsObjects(params.listarVendas));

  // dataCredito === null aqui significa "nenhuma data da lista de Data
  // Crédito cai neste período" (ver parseDataCreditoNoPeriodo) — replica
  // `if not datas_no_periodo: continue` do script real.
  const crRows = crRowsAll.filter((r) => statusAceitoCR(r.status) && r.dataCredito !== null);
  const lvRows = lvRowsAll.filter((r) => STATUS_ACEITOS_LV.includes(r.status));

  const resultado = categorizeInvoices(crRows, lvRows, params.rules);

  // Conferência exigida pela skill original (ADR-0018): soma de "Valor
  // Recebido" do CR aceito deve bater com a soma de "Valor Recebido Cat."
  // das linhas produzidas. O rateio garante fechamento por fatura, então
  // isto deve dar zero sempre.
  const somaValorRecebidoCR = roundMoney(sum(crRows.map((r) => r.valorRecebido)));
  const diferencaConferencia = roundMoney(somaValorRecebidoCR.minus(resultado.totalRecebido));

  return { crRowsAll, lvRowsAll, crRows, lvRows, resultado, somaValorRecebidoCR, diferencaConferencia, periodoFimEfetivo };
}
