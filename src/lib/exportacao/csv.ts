import { money, toAmountString, ZERO } from "@/lib/money";
import type { Cell, Sheet } from "@/lib/xlsx/writer";
import type { EsperadoNaAba } from "./planilha";
import { CSV_CONTENT_TYPE, ExportacaoInconsistenteError } from "./tipos";

/**
 * Formato CSV da central de exportação (ADR-0035). PURO.
 *
 * Convenções do Excel/Google Sheets em português (os usuários são do financeiro): separador `;`, decimal com VÍRGULA,
 * datas `dd/mm/aaaa`, UTF-8 COM BOM (sem o BOM o Excel abre os acentos errados) e fim de linha CRLF.
 *
 * O CSV leva só a aba PRINCIPAL (o detalhe) — sem Leia-me, resumos nem abas extras. Quem precisa do contexto (filtros,
 * hora, atualidade dos dados, conferência) deve usar o .xlsx; a tela diz isso.
 *
 * ⚠ INJEÇÃO DE FÓRMULA: uma célula de TEXTO que comece com `=`, `+`, `-`, `@`, tab ou CR é executada como fórmula pelo
 * Excel/Sheets ao abrir o CSV (ex.: um campo Observações do Conexa com `=HYPERLINK(...)`). Todo texto assim recebe um
 * apóstrofo na frente (recomendação OWASP). No .xlsx isso não existe: o texto é gravado como string inline.
 * Números e datas NUNCA recebem apóstrofo (um valor negativo "-12,50" é número, não texto).
 */

export const SEPARADOR_CSV = ";";
const BOM = "﻿";
const FIM_DE_LINHA = "\r\n";

const p2 = (n: number) => String(n).padStart(2, "0");
const dataDeSerie = (serial: number): Date => new Date(Math.round((serial - 25_569) * 86_400_000));
const dataBr = (d: Date) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const dataHoraBr = (d: Date) => `${dataBr(d)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;

const PERIGO_DE_FORMULA = /^[=+\-@\t\r]/;

/** Aspas só quando precisa (separador, aspas, quebra de linha), com as aspas internas dobradas. */
function campo(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Texto de uma célula de TEXTO: com a proteção contra fórmula. */
export function textoCsv(s: string): string {
  return campo(PERIGO_DE_FORMULA.test(s) ? `'${s}` : s);
}

function celulaParaCsv(c: Cell): string {
  switch (c.kind) {
    case "blank":
      return "";
    case "text":
      return textoCsv(c.text ?? "");
    case "formula":
    case "num": {
      const n = c.num;
      if (n === undefined || n === null || n === "") return "";
      switch (c.style) {
        case 5:
          return dataBr(dataDeSerie(Number(n)));
        case 6:
          return dataHoraBr(dataDeSerie(Number(n)));
        case 2:
        case 3:
        case 4:
        case 11:
          return n.replace(".", ","); // dinheiro e percentual: vírgula decimal
        default:
          return n; // id, inteiro: como está
      }
    }
  }
}

/** Quantas linhas de DADOS a aba tem (as que o autofiltro cobre; sem autofiltro, até a primeira linha vazia). */
export function linhasDeDados(aba: Sheet): number {
  if (aba.autoFiltro) return Math.max(0, aba.autoFiltro.ultimaLinha - aba.autoFiltro.primeiraLinha);
  let n = 0;
  for (let i = 1; i < aba.rows.length; i++) {
    if (aba.rows[i]!.length === 0) break;
    n += 1;
  }
  return n;
}

/**
 * Célula do CABEÇALHO: SEMPRE entre aspas. Um CSV que começa por "ID" (depois do BOM) é tratado pelo Excel como arquivo
 * SYLK e recusado com "SYLK: File format is not valid" quando aberto por duplo clique — e vários cabeçalhos começam por
 * "ID" (ID da fatura, ID da rodada). Entre aspas o arquivo deixa de parecer SYLK, e `lerCsv` lê igual.
 */
function cabecalhoParaCsv(c: Cell): string {
  if (c.kind !== "text") return celulaParaCsv(c);
  const t = c.text ?? "";
  return `"${(PERIGO_DE_FORMULA.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
}

/** A aba como texto CSV: cabeçalho + linhas de dados (rodapé TOTAL, notas e linhas em branco ficam de fora). */
export function csvDaAba(aba: Sheet): { texto: string; nLinhas: number } {
  const n = linhasDeDados(aba);
  const linhas: string[] = [];
  for (let i = 0; i <= n; i++) {
    const row = aba.rows[i];
    if (!row) break;
    linhas.push(row.map(i === 0 ? cabecalhoParaCsv : celulaParaCsv).join(SEPARADOR_CSV));
  }
  return { texto: BOM + linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA, nLinhas: n };
}

/** Lê o CSV de volta (aspas, separador e quebras dentro de campo). Só para a conferência e os testes. */
export function lerCsv(texto: string): string[][] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let atual: string[] = [];
  let valor = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          valor += '"';
          i += 1;
        } else aspas = false;
      } else valor += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === SEPARADOR_CSV) {
      atual.push(valor);
      valor = "";
    } else if (ch === "\r") {
      // o "\n" seguinte fecha a linha
    } else if (ch === "\n") {
      atual.push(valor);
      linhas.push(atual);
      atual = [];
      valor = "";
    } else valor += ch;
  }
  if (valor !== "" || atual.length) {
    atual.push(valor);
    linhas.push(atual);
  }
  return linhas;
}

/** O texto do campo sem as aspas de CSV (aspas dobradas dentro de aspas viram uma): a mesma regra de `lerCsv`. */
function desaspar(bruto: string): string {
  let saida = "";
  let dentro = false;
  for (let i = 0; i < bruto.length; i++) {
    const ch = bruto[i]!;
    if (dentro) {
      if (ch === '"') {
        if (bruto[i + 1] === '"') {
          saida += '"';
          i += 1;
        } else dentro = false;
      } else saida += ch;
    } else if (ch === '"') dentro = true;
    else saida += ch;
  }
  return saida;
}

/**
 * Varre o CSV UMA vez sem guardar os campos: só o cabeçalho (em `cabecalho`, preenchido aqui) e, para cada linha de
 * DADOS, quantos campos ela tem e o valor da coluna `indiceValor` (ou `undefined` se a linha é curta / `indiceValor < 0`).
 * É o que a conferência precisa. `lerCsv` guarda TUDO (uns 25 bytes de heap por caractere): um CSV de 20 mil linhas com
 * Observações longas precisava de mais de 500 MB só para a matriz e derrubava o processo, que também serve o painel.
 * `aoRegistro` recebe o número da linha (1 = cabeçalho, então a primeira de dados é a 2).
 */
export function varrerCsv(texto: string, indiceValor: number, cabecalho: string[], aoRegistro: (linha: number, campos: number, valor: string | undefined) => void): void {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const SEP = SEPARADOR_CSV.charCodeAt(0);
  let linha = 1;
  let campos = 0;
  let ini = 0;
  let aspas = false;
  let temAspas = false;
  let valor: string | undefined;

  const fecharCampo = (fim: number) => {
    if (linha === 1 || campos === indiceValor) {
      let v = t.slice(ini, fim);
      if (temAspas) v = desaspar(v);
      if (linha === 1) cabecalho.push(v);
      else valor = v;
    }
    campos += 1;
    temAspas = false;
  };
  const fecharLinha = () => {
    if (linha > 1) aoRegistro(linha, campos, valor);
    linha += 1;
    campos = 0;
    valor = undefined;
  };

  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (aspas) {
      if (c === 34) {
        if (t.charCodeAt(i + 1) === 34) i += 1;
        else aspas = false;
      }
      continue;
    }
    if (c === 34) {
      aspas = true;
      temAspas = true;
    } else if (c === SEP) {
      fecharCampo(i);
      ini = i + 1;
    } else if (c === 13 && t.charCodeAt(i + 1) === 10) {
      fecharCampo(i);
      fecharLinha();
      i += 1;
      ini = i + 1;
    } else if (c === 10) {
      fecharCampo(i);
      fecharLinha();
      ini = i + 1;
    }
  }
  if (ini < t.length || campos > 0) {
    fecharCampo(t.length);
    fecharLinha();
  }
}

/** Confere o CSV pronto, relido: cabeçalho, número de linhas, largura de cada linha e soma da coluna de valor. */
export function conferirCsv(texto: string, esperado: EsperadoNaAba | undefined): string[] {
  const problemas: string[] = [];
  const cabecalho: string[] = [];
  const somar = esperado !== undefined && esperado.indiceValor >= 0 && esperado.total !== null;
  const indiceValor = somar ? esperado!.indiceValor : -1;
  let nDados = 0;
  let soma = ZERO;
  varrerCsv(texto, indiceValor, cabecalho, (linha, campos, valorBruto) => {
    nDados += 1;
    if (campos !== cabecalho.length && problemas.length < 5) problemas.push(`linha ${linha}: ${campos} campos, o cabeçalho tem ${cabecalho.length}`);
    if (!somar) return;
    const v = (valorBruto ?? "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(v)) {
      if (problemas.length < 10) problemas.push(`linha ${linha}: valor "${valorBruto ?? ""}" não é número`);
      return;
    }
    soma = soma.plus(money(v));
  });
  if (!esperado) return problemas;
  esperado.titulos.forEach((t, i) => {
    if (cabecalho[i] !== t) problemas.push(`cabeçalho da coluna ${i + 1}: esperado "${t}", lido "${cabecalho[i] ?? ""}"`);
  });
  if (nDados !== esperado.nLinhas) problemas.push(`o CSV tem ${nDados} linha(s) de dados, esperado ${esperado.nLinhas}`);
  if (somar && toAmountString(soma) !== esperado.total) problemas.push(`soma lida do CSV (${toAmountString(soma)}) ≠ esperada (${esperado.total})`);
  return problemas;
}

/** O CSV da aba principal, conferido. Lança `ExportacaoInconsistenteError` se a leitura de volta não fechar. */
export function gerarCsvConferido(aba: Sheet, esperado: EsperadoNaAba | undefined): { buffer: Buffer; contentType: string } {
  const { texto } = csvDaAba(aba);
  const problemas = conferirCsv(texto, esperado ? { ...esperado, nLinhas: esperado.nLinhas } : undefined);
  if (problemas.length) throw new ExportacaoInconsistenteError(`Conferência de leitura do CSV não fechou — o arquivo não foi entregue. ${problemas.join("; ")}.`);
  return { buffer: Buffer.from(texto, "utf8"), contentType: CSV_CONTENT_TYPE };
}
