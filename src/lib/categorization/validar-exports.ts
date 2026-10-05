import { readXlsxRows } from "@/lib/xlsx/reader";
import { parseFlexibleDate } from "@/lib/categorization/parse-exports";

/**
 * Validação dos dois arquivos que uma PESSOA envia na importação manual.
 *
 * Pura. Existe porque, ao contrário do download automático (que sempre traz o
 * arquivo certo, do filtro certo), um arquivo enviado à mão pode estar trocado,
 * ser de outra tela, ter sido aberto e salvo no Excel (que reescreve datas e
 * estrutura) ou estar vazio — e a persistência APAGA o que não vier no arquivo.
 * Cada falha aqui vira uma mensagem que diz o que a pessoa deve fazer, nunca um
 * erro técnico cru.
 */

export class ImportacaoInvalidaError extends Error {}

/** Colunas sem as quais a rodada não consegue interpretar o Contas a Receber. */
export const COLUNAS_CONTAS_RECEBER = [
  "ID",
  "ID Cliente",
  "Razão Social Cliente",
  "Plano(s) Contratado(s)",
  "Status",
  "Valor Recebido",
  "Data Crédito",
] as const;

/** Colunas sem as quais a rodada não consegue interpretar o Listar Vendas. */
export const COLUNAS_LISTAR_VENDAS = [
  "ID",
  "Cliente ID",
  "Serviço/Item",
  "Valor (R$)",
  "Status",
  "Referência Cobrança",
] as const;

/**
 * Limite de tamanho. O envio inteiro (os DOIS arquivos) passa pelo middleware do Next, que só
 * entrega os primeiros 10 MB do corpo — acima disso o formulário chega truncado e ilegível.
 * Medido em 2026-10-06: 32 MB → corpo cortado. Um mês real tem centenas de KB (o .xlsx do
 * Conexa é comprimido), então 4,5 MB por arquivo sobra, e dois arquivos nunca passam de 10 MB.
 */
export const TAMANHO_MAXIMO_BYTES = 4.5 * 1024 * 1024;
export const TAMANHO_MAXIMO_ENVIO_BYTES = 10 * 1024 * 1024;
export const TAMANHO_MAXIMO_TEXTO = "4,5 MB por arquivo";

export interface ResumoArquivos {
  linhasContasReceber: number;
  linhasListarVendas: number;
}

function lerCabecalho(buf: Buffer, nome: string): { cabecalho: string[]; corpo: string[][] } {
  // Um .xlsx é um ZIP: começa com "PK". Barra CSV, PDF e HTML com uma mensagem clara
  // em vez do "xlsx inválido: EOCD não encontrada" do leitor.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new ImportacaoInvalidaError(
      `${nome} não é um arquivo .xlsx. Envie o arquivo exatamente como o Conexa baixou ("Exportar" → Excel), sem converter.`,
    );
  }
  let linhas: string[][];
  try {
    linhas = readXlsxRows(buf);
  } catch (err) {
    throw new ImportacaoInvalidaError(
      `${nome} não pôde ser lido (${err instanceof Error ? err.message : "formato inesperado"}). ` +
        "Se você abriu e salvou o arquivo no Excel, baixe-o de novo do Conexa e envie o original, sem abrir.",
    );
  }
  const [cabecalho, ...corpo] = linhas;
  if (!cabecalho || cabecalho.every((c) => !c)) {
    throw new ImportacaoInvalidaError(`${nome} está vazio (sem linha de cabeçalho).`);
  }
  return { cabecalho, corpo: corpo.filter((l) => l.some((c) => c !== "")) };
}

/**
 * Confere que os dois arquivos são do tipo certo, não estão trocados, têm dados e que
 * as datas de crédito são legíveis. Lança `ImportacaoInvalidaError` com a instrução.
 */
export function validarArquivos(contasReceber: Buffer, listarVendas: Buffer): ResumoArquivos {
  const cr = lerCabecalho(contasReceber, "O arquivo de Contas a Receber");
  const lv = lerCabecalho(listarVendas, "O arquivo de Listar Vendas");

  const temCR = (c: string[]) => COLUNAS_CONTAS_RECEBER.every((x) => c.includes(x));
  const temLV = (c: string[]) => COLUNAS_LISTAR_VENDAS.every((x) => c.includes(x));

  // Trocados: o "de Contas a Receber" é na verdade um Listar Vendas e vice-versa.
  if (!temCR(cr.cabecalho) && temLV(cr.cabecalho) && temCR(lv.cabecalho)) {
    throw new ImportacaoInvalidaError(
      "Os dois arquivos estão trocados: o campo de Contas a Receber recebeu o Listar Vendas e vice-versa. Inverta os arquivos.",
    );
  }
  if (!temCR(cr.cabecalho)) {
    const faltam = COLUNAS_CONTAS_RECEBER.filter((x) => !cr.cabecalho.includes(x));
    throw new ImportacaoInvalidaError(
      `O arquivo de Contas a Receber não parece ser esse export: faltam as colunas ${faltam.map((f) => `"${f}"`).join(", ")}.`,
    );
  }
  if (!temLV(lv.cabecalho)) {
    const faltam = COLUNAS_LISTAR_VENDAS.filter((x) => !lv.cabecalho.includes(x));
    throw new ImportacaoInvalidaError(
      `O arquivo de Listar Vendas não parece ser esse export: faltam as colunas ${faltam.map((f) => `"${f}"`).join(", ")}.`,
    );
  }

  if (cr.corpo.length === 0) {
    throw new ImportacaoInvalidaError(
      "O Contas a Receber não tem nenhuma linha. Confira o filtro de Data de Crédito no Conexa antes de exportar.",
    );
  }
  if (lv.corpo.length === 0) {
    throw new ImportacaoInvalidaError(
      "O Listar Vendas não tem nenhuma linha. Confira o filtro de Data de Crédito no Conexa antes de exportar.",
    );
  }

  // Datas legíveis: se NENHUMA "Data Crédito" é lida pelo parser, o arquivo foi reescrito
  // (Excel troca "dd/mm/aaaa" por número serial) — e a rodada excluiria todas as faturas.
  const iData = cr.cabecalho.indexOf("Data Crédito");
  const comTexto = cr.corpo.filter((l) => (l[iData] ?? "") !== "");
  const legiveis = comTexto.filter((l) => (l[iData] ?? "").split(",").some((p) => parseFlexibleDate(p) !== null));
  if (comTexto.length === 0 || legiveis.length === 0) {
    throw new ImportacaoInvalidaError(
      'A coluna "Data Crédito" do Contas a Receber está vazia ou ilegível (datas esperadas como dd/mm/aaaa). ' +
        "Se você abriu e salvou o arquivo no Excel, baixe-o de novo do Conexa e envie o original, sem abrir.",
    );
  }

  return { linhasContasReceber: cr.corpo.length, linhasListarVendas: lv.corpo.length };
}
