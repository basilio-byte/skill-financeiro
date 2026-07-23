import { readXlsxAsObjects, parseMoneyCell } from "@/lib/xlsx/reader";
import type { ContasReceberRow, ListarVendasRow } from "@/lib/categorization/types";

/**
 * Converte as linhas cruas dos dois exports do Conexa (objetos por cabeçalho,
 * ver xlsx/reader.ts) para os tipos tipados usados pelo motor de categorização.
 *
 * Nomes de coluna confirmados contra exports reais em 2026-07-21 (ver
 * docs/context/conexa-integration.md). Datas no Conexa aparecem tanto em
 * "dd/mm/yyyy" quanto, ocasionalmente, em "yyyy-mm-dd" — `parseFlexibleDate`
 * aceita os dois formatos.
 */

/** Aceita "dd/mm/yyyy" ou "yyyy-mm-dd"; datas com hora (ex. "20/07/2026 17:08:35") usam só a parte de data. */
export function parseFlexibleDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim().split(" ")[0];
  if (!s) return null;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  }
  return null;
}

/**
 * Extrai, de uma "Data Crédito" que pode vir como LISTA de datas separadas
 * por vírgula (faturas recorrentes/parceladas — confirmado em export real),
 * a PRIMEIRA que cai dentro de `[periodoInicio, periodoFim]` — ambos
 * inclusive, mesma semântica de comparação por data (sem hora) do script
 * real. PORTA EXATA da decisão de inclusão de `categoriza_receita.py`
 * (variável `datas_no_periodo`, ver ADR-0018): uma fatura recorrente com uma
 * data por mês é "desta rodada" se QUALQUER uma das suas datas cair na
 * janela pedida — não só a primeira da lista, que era o comportamento
 * anterior desta função (`parseFirstDateFromList`).
 *
 * Retorna `null` se NENHUMA data da lista cair no período — `run.ts` usa
 * isso para EXCLUIR a fatura desta rodada, replicando
 * `if not datas_no_periodo: continue` do Python.
 *
 * Efeito aceito conscientemente (ADR-0018, decisão explícita do usuário):
 * como persistimos só UMA data por linha (upsert por fatura), a MESMA fatura
 * recorrente pode ficar "associada" a meses diferentes ao longo do tempo,
 * conforme sincronizações rodem para períodos diferentes e cada uma capture
 * uma data distinta da lista. Isso não é um risco introduzido pela nossa
 * sincronização automática de 15 min — é uma propriedade do próprio script
 * original: se a Duda rodasse `categoriza_receita.py` duas vezes para
 * períodos sobrepostos, a mesma fatura apareceria nas duas planilhas
 * resultado, cada uma contando por completo a fatura para aquele período.
 */
function parseDataCreditoNoPeriodo(
  raw: string | null | undefined,
  periodoInicio: Date,
  periodoFim: Date,
): Date | null {
  if (!raw) return null;
  for (const parte of raw.split(",")) {
    const dt = parseFlexibleDate(parte);
    if (dt && dt.getTime() >= periodoInicio.getTime() && dt.getTime() <= periodoFim.getTime()) {
      return dt;
    }
  }
  return null;
}

function parseIntOrNull(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseContasReceberRows(
  objects: Array<Record<string, string>>,
  periodoInicio: Date,
  periodoFim: Date,
): ContasReceberRow[] {
  return objects.map((row) => ({
    id: parseIntOrNull(row["ID"]) ?? 0,
    unidade: row["Unidade"] ?? "",
    faturamento: row["Faturamento"] ?? "",
    clienteId: parseIntOrNull(row["ID Cliente"]),
    cpfCnpj: row["CPF/CNPJ"] ?? "",
    razaoSocial: row["Razão Social Cliente"] ?? "",
    planoContratado: row["Plano(s) Contratado(s)"] ?? "",
    tipo: row["Tipo"] ?? "",
    status: row["Status"] ?? "",
    parcela: row["Parcela"] ?? "",
    valorBruto: parseMoneyCell(row["Valor Bruto"]),
    valorRecebido: parseMoneyCell(row["Valor Recebido"]),
    valorDesconto: parseMoneyCell(row["Valor Desconto"]),
    vencimento: parseFlexibleDate(row["Vencimento"]),
    quitacao: parseFlexibleDate(row["Quitação"]),
    competencia: parseFlexibleDate(row["Competência"]),
    emissao: parseFlexibleDate(row["Emissão"]),
    dataCredito: parseDataCreditoNoPeriodo(row["Data Crédito"], periodoInicio, periodoFim),
    conta: row["Conta"] ?? "",
    observacoes: row["Observações"] ?? "",
    tags: row["Tags"] ?? "",
    raw: row,
  }));
}

export function parseListarVendasRows(objects: Array<Record<string, string>>): ListarVendasRow[] {
  return objects.map((row) => ({
    id: parseIntOrNull(row["ID"]) ?? 0,
    clienteId: parseIntOrNull(row["Cliente ID"]),
    servicoItem: row["Serviço/Item"] ?? "",
    categoriaConexa: row["Categoria"] ?? "",
    data: parseFlexibleDate(row["Data"]),
    valor: parseMoneyCell(row["Valor (R$)"]),
    valorDesconto: parseMoneyCell(row["Valor Desconto"]),
    status: row["Status"] ?? "",
    referenciaCobranca: parseFlexibleDate(row["Referência Cobrança"]),
    raw: row,
  }));
}

/** "yyyy-mm" a partir de uma data, para a chave de join Cliente×mês. */
export function yearMonthKey(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
