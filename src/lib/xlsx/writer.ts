/**
 * Gerador de .xlsx SEM depender de biblioteca.
 *
 * Por que escrever à mão em vez de puxar SheetJS/exceljs: (1) mantém o container
 * leve e a superfície de manutenção pequena; (2) — e isto é rigor financeiro — os
 * números são gravados como NÚMERO de verdade (`<v>1234.56</v>`), não como texto.
 * O Excel soma a coluna certo. É exatamente o oposto do bug que este projeto trata
 * defensivamente ao LER o export do Conexa (ver xlsx/reader.ts), que mistura float
 * cru e texto BR na mesma coluna e faz as maiores cobranças virarem zero.
 *
 * Um .xlsx é um ZIP (Open Packaging Conventions) com XML dentro. Usamos:
 *  - strings inline (`t="inlineStr"`) — dispensa a tabela de sharedStrings;
 *  - `styles.xml` mínimo: cabeçalho em negrito + formato R$ e %;
 *  - ZIP com método STORE (sem compressão) — CRC32 próprio, simples e válido.
 *
 * Os VALORES numéricos entram como string decimal já arredondada (ex.: "1234.56"),
 * escritas verbatim no `<v>` — nenhuma conversão para float acontece aqui, então
 * não há drift. A formatação (R$, %) é só apresentação; o valor guardado é exato.
 *
 * ADR-0035 (central de exportação): o gerador ganhou, de forma RETROCOMPATÍVEL, datas de verdade, autofiltro, painel
 * congelado, fórmulas e compressão DEFLATE opcional. Nada disso aparece num arquivo que não os peça — a exportação
 * por rodada continua byte a byte igual (travado em writer.compat.test.ts).
 */
import { promisify } from "node:util";
import { deflateRaw, deflateRawSync, type ZlibOptions } from "node:zlib";

// ---------------------------------------------------------------------------
// Modelo de célula
// ---------------------------------------------------------------------------

// Estilos 0–4: os de sempre — a exportação por rodada só usa estes (ver writer.compat.test.ts).
// Estilos 5–13 (ADR-0035, central de exportação): data, data e hora, texto com quebra, cabeçalho destacado, inteiro,
// inteiro em negrito, % em negrito, cabeçalho destacado alinhado à direita (colunas numéricas). Só entram no arquivo quando algum recurso novo é usado, para que o arquivo
// antigo continue idêntico byte a byte.
type StyleIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Cell {
  kind: "text" | "num" | "blank" | "formula";
  text?: string;
  /** valor numérico como string decimal exata (ex.: "1234.56"); nunca float. */
  num?: string;
  /** só em `kind: "formula"`: a fórmula SEM o "=" (ex.: "SUBTOTAL(109,E2:E100)"); `num` leva o valor em cache. */
  formula?: string;
  style: StyleIndex;
}

export type Row = Cell[];

export interface Sheet {
  name: string;
  rows: Row[];
  /** larguras de coluna (em "caracteres" do Excel), opcional. */
  colWidths?: number[];
  /** Congela as N primeiras linhas: o cabeçalho continua visível ao rolar. */
  congelarLinhas?: number;
  /** Setas de filtro no cabeçalho, sobre A{primeiraLinha}:{última coluna}{ultimaLinha}. Linhas 1-based, coluna 0-based. */
  autoFiltro?: { primeiraLinha: number; ultimaLinha: number; ultimaColuna: number };
}

export interface OpcoesXlsx {
  /** DEFLATE em vez de STORE. Padrão: false (o arquivo antigo não muda). */
  comprimir?: boolean;
}

/** Normaliza número|string decimal para string exata para o `<v>`. */
function normNum(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "number" ? String(v) : v.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/** Célula de texto. */
export const T = (s: unknown): Cell => ({ kind: "text", text: s === null || s === undefined ? "" : String(s), style: 0 });
/** Cabeçalho (negrito). */
export const H = (s: string): Cell => ({ kind: "text", text: s, style: 1 });
/** Número simples (2+ casas, sem símbolo). */
export const N = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? T(v ?? "") : { kind: "num", num: n, style: 0 };
};
/** Valor em Real (R$), somável no Excel. */
export const BRL = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? T(v ?? "") : { kind: "num", num: n, style: 2 };
};
/** Valor em Real em NEGRITO (linhas de total). */
export const BRLB = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? H(String(v ?? "")) : { kind: "num", num: n, style: 4 };
};
export const BLANK: Cell = { kind: "blank", style: 0 };

// --- Células da central de exportação (ADR-0035) -----------------------------------------------------------

const MS_DIA = 86_400_000;
/** Dias entre 1899-12-30 (a "época" do Excel) e 1970-01-01. */
const EPOCA_EXCEL_EM_DIAS = 25_569;

/** Texto com quebra de linha, alinhado ao topo (aba Leia-me). */
export const W = (s: unknown): Cell => ({ kind: "text", text: s === null || s === undefined ? "" : String(s), style: 7 });
/** Cabeçalho destacado: negrito, fundo e borda inferior. */
export const HX = (s: string): Cell => ({ kind: "text", text: s, style: 8 });
/** Cabeçalho destacado ALINHADO À DIREITA (colunas numéricas: o título fica sobre os números). */
export const HXR = (s: string): Cell => ({ kind: "text", text: s, style: 12 });
/** Rótulo em negrito COM quebra de linha, alinhado ao topo (rótulos longos do Leia-me não são cortados). */
export const WB = (s: unknown): Cell => ({ kind: "text", text: s === null || s === undefined ? "" : String(s), style: 13 });
/** Inteiro com separador de milhar. */
export const INT = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? T(v ?? "") : { kind: "num", num: n, style: 9 };
};
/** Inteiro em NEGRITO (linhas de total). */
export const INTB = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? H(String(v ?? "")) : { kind: "num", num: n, style: 10 };
};
/** Percentual (o número é a porcentagem: "12.34" → 12,34%). */
export const PCT = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? T(v ?? "") : { kind: "num", num: n, style: 3 };
};
/** Percentual em NEGRITO. */
export const PCTB = (v: string | number | null | undefined): Cell => {
  const n = normNum(v);
  return n === null ? H(String(v ?? "")) : { kind: "num", num: n, style: 11 };
};
/**
 * Data-calendário de verdade (o Excel ordena e filtra por data). Lê a data em UTC, como o resto do app faz com
 * colunas `@db.Date` (meia-noite UTC) — nunca no fuso local, que deslizaria um dia.
 */
export const D = (d: Date | null | undefined): Cell => {
  if (!d || Number.isNaN(d.getTime())) return BLANK;
  return { kind: "num", num: String(Math.floor(d.getTime() / MS_DIA) + EPOCA_EXCEL_EM_DIAS), style: 5 };
};
/**
 * Data e hora de PAREDE: os campos UTC do `Date` recebido são lidos como o relógio que a pessoa vê. Quem chama
 * converte o instante para o fuso do app antes (o Excel não tem fuso).
 */
export const DT = (d: Date | null | undefined): Cell => {
  if (!d || Number.isNaN(d.getTime())) return BLANK;
  // Dia inteiro + fração do dia calculada de milissegundos INTEIROS, com um único arredondamento (o do `double` mais
  // próximo, que o JS imprime em até 17 dígitos — o mesmo que o Excel grava). Cortar a fração em 8 casas deixava
  // 00:01:00 em 00:00:59,9996 e o LibreOffice mostrava 00:00:59 (3,5 mil de 7,2 mil horários testados).
  const ms = d.getTime();
  const dias = Math.floor(ms / MS_DIA);
  const serial = dias + EPOCA_EXCEL_EM_DIAS + (ms - dias * MS_DIA) / MS_DIA;
  return { kind: "num", num: String(serial), style: 6 };
};
/** Fórmula em R$ negrito, com o valor em cache (quem não recalcula vê o número certo). */
export const FBRL = (formula: string, emCache: string | number): Cell => ({
  kind: "formula",
  formula,
  num: normNum(emCache) ?? undefined,
  style: 4,
});

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Índice de coluna (0-based) → letra ("A", "Z", "AA"...). */
function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Nome de aba seguro: sem caracteres proibidos, máx. 31, não vazio. */
function safeSheetName(name: string, fallback: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return clean.length ? clean : fallback;
}

function cellXml(cell: Cell, ref: string): string {
  const s = cell.style ? ` s="${cell.style}"` : "";
  if (cell.kind === "formula" && cell.formula) {
    const v = cell.num !== null && cell.num !== undefined ? `<v>${cell.num}</v>` : "";
    return `<c r="${ref}"${s}><f>${esc(cell.formula)}</f>${v}</c>`;
  }
  if (cell.kind === "num" && cell.num !== null && cell.num !== undefined) {
    return `<c r="${ref}"${s}><v>${cell.num}</v></c>`;
  }
  if (cell.kind === "text" && cell.text) {
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.text)}</t></is></c>`;
  }
  return `<c r="${ref}"${s}/>`;
}

/**
 * O XML de uma aba, em passos: cada `yield` vem depois de uma fatia de 500 linhas. `sheetXml` (síncrono) roda tudo de uma
 * vez, como sempre; `buildXlsxAsync` devolve o controle ao event loop entre os passos. É o MESMO código — a saída é
 * byte a byte a mesma nos dois caminhos.
 */
function* sheetXmlPassos(sheet: Sheet): Generator<void, Buffer, void> {
  const cols = sheet.colWidths?.length
    ? `<cols>${sheet.colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  // Em FATIAS de linhas, cada uma já virando Buffer: uma aba de 24 mil linhas tem dezenas de MB de XML, e montar tudo
  // numa string única mantinha várias cópias dele ao mesmo tempo (array de linhas, string unida, template, Buffer). A
  // codificação UTF-8 da concatenação é a concatenação das codificações (as fatias partem em limite de linha), então os
  // bytes são os MESMOS de antes — travado pelos hashes de writer.compat.test.ts.
  const FATIA = 500;
  const letras: string[] = [];
  const letra = (c: number) => (letras[c] ??= colLetter(c));
  const corpo: Buffer[] = [];
  for (let i = 0; i < sheet.rows.length; i += FATIA) {
    let s = "";
    const fim = Math.min(i + FATIA, sheet.rows.length);
    for (let r = i; r < fim; r++) {
      const row = sheet.rows[r]!;
      let cells = "";
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell !== undefined) cells += cellXml(cell, `${letra(c)}${r + 1}`); // (buraco em array esparso: pula, como o .map fazia)
      }
      s += `<row r="${r + 1}">${cells}</row>`;
    }
    corpo.push(Buffer.from(s, "utf8"));
    yield;
  }
  // ⚠ ORDEM IMPORTA: no schema CT_Worksheet do OOXML (ECMA-376), <cols> vem ANTES de
  // <sheetData>. Emitir <cols> depois faz o Excel abrir o arquivo em modo de reparo
  // e descartar as larguras. Por isso `${cols}` precede `<sheetData>`.
  // Mesma regra para os recursos novos: <sheetViews> vem antes de <cols>, <autoFilter> depois de <sheetData>.
  // Sem congelar/filtrar, as duas variáveis são "" e a saída é idêntica à de antes.
  const n = sheet.congelarLinhas && sheet.congelarLinhas > 0 ? Math.floor(sheet.congelarLinhas) : 0;
  const views = n
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${n + 1}" sqref="A${n + 1}"/></sheetView></sheetViews>`
    : "";
  const f = sheet.autoFiltro;
  const filtro = f ? `<autoFilter ref="A${f.primeiraLinha}:${colLetter(f.ultimaColuna)}${f.ultimaLinha}"/>` : "";
  const cabeca = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${cols}<sheetData>`;
  const cauda = `</sheetData>${filtro}</worksheet>`;
  return Buffer.concat([Buffer.from(cabeca, "utf8"), ...corpo, Buffer.from(cauda, "utf8")]);
}

function sheetXml(sheet: Sheet): Buffer {
  const passos = sheetXmlPassos(sheet);
  let r = passos.next();
  while (!r.done) r = passos.next();
  return r.value;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/>
<numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Folha de estilos ESTENDIDA — usada só quando alguma célula/aba usa recurso novo (estilo ≥ 5, fórmula, filtro ou
 * painel congelado). Os índices 0–4 têm o MESMO significado da folha antiga; 5–11 são os novos:
 *   5 data · 6 data e hora · 7 texto com quebra · 8 cabeçalho destacado · 9 inteiro · 10 inteiro em negrito · 11 % em negrito
 *   · 12 cabeçalho destacado à direita · 13 negrito com quebra, ao topo.
 * Os dois primeiros preenchimentos (nenhum e gray125) são obrigatórios por convenção do Excel.
 */
const STYLES_XML_EXT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/>
<numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>
<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="167" formatCode="dd/mm/yyyy\\ hh:mm"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EDF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8FA0B3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------------------------------------------------------------------------
// ZIP (método STORE) — CRC32 próprio
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Um pedaço do CRC-32 (`c` é o estado corrente; começa em 0xffffffff e termina com `^ 0xffffffff`). */
function crcAtualizar(c: number, buf: Buffer, ini: number, fim: number): number {
  for (let i = ini; i < fim; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return c;
}

function crc32(buf: Buffer): number {
  return (crcAtualizar(0xffffffff, buf, 0, buf.length) ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Uma entrada do ZIP já com CRC e (se for o caso) já comprimida: é o que `montarZip` precisa para escrever os cabeçalhos. */
interface EntradaZipPronta {
  nome: Buffer;
  crc: number;
  /** Tamanho ORIGINAL (descomprimido). */
  tamanho: number;
  dados: Buffer;
  metodo: 0 | 8;
}

/** Escreve os cabeçalhos locais, o diretório central e o fim do ZIP. Compartilhado pelos caminhos síncrono e assíncrono. */
function montarZip(entradas: EntradaZipPronta[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;

  for (const e of entradas) {
    const nameBuf = e.nome;
    const crc = e.crc;
    const size = e.tamanho;
    const dados = e.dados;
    const metodo = e.metodo;
    const csize = dados.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dados);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(metodo, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(csize, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + csize;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/**
 * Monta um ZIP. Padrão: STORE (sem compressão), válido em Excel. Com `comprimir`, cada arquivo vai em DEFLATE
 * (método 8) — o que importa para exportações de meses/anos inteiros: o XML se repete muito e comprime ~10×.
 * Sem `comprimir`: método 0 e tamanho comprimido = tamanho original — exatamente os bytes de sempre.
 */
function buildZip(entries: ZipEntry[], comprimir = false): Buffer {
  return montarZip(
    entries.map((e) => ({
      nome: Buffer.from(e.name, "utf8"),
      crc: crc32(e.data),
      tamanho: e.data.length,
      dados: comprimir ? deflateRawSync(e.data, { level: 6 }) : e.data,
      metodo: comprimir ? 8 : 0,
    })),
  );
}

// ---------------------------------------------------------------------------
// Caminho ASSÍNCRONO (só a central de exportação): devolve o controle ao event loop
// ---------------------------------------------------------------------------

/** Devolve o controle ao event loop (a central passa a dela, que também confere cancelamento e prazo). */
export type Ceder = () => Promise<void>;
const cederPadrao: Ceder = () => new Promise<void>((resolve) => setImmediate(resolve));

const deflateRawAsync = promisify(deflateRaw) as (buf: Buffer, opcoes: ZlibOptions) => Promise<Buffer>;

/** CRC-32 em pedaços de 4 MB, cedendo o event loop entre eles. O resultado é o mesmo de `crc32`. */
async function crc32Async(buf: Buffer, ceder: Ceder): Promise<number> {
  const PASSO = 4 * 1024 * 1024;
  let c = 0xffffffff;
  for (let ini = 0; ini < buf.length; ini += PASSO) {
    c = crcAtualizar(c, buf, ini, Math.min(ini + PASSO, buf.length));
    if (ini + PASSO < buf.length) await ceder();
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Como `buildZip`, mas o DEFLATE roda fora do event loop (zlib assíncrono, no pool de threads) e o CRC cede entre pedaços. */
async function buildZipAsync(entries: ZipEntry[], comprimir: boolean, ceder: Ceder): Promise<Buffer> {
  const prontas: EntradaZipPronta[] = [];
  for (const e of entries) {
    const crc = await crc32Async(e.data, ceder);
    const dados = comprimir ? await deflateRawAsync(e.data, { level: 6 }) : e.data;
    prontas.push({ nome: Buffer.from(e.name, "utf8"), crc, tamanho: e.data.length, dados, metodo: comprimir ? 8 : 0 });
    await ceder();
  }
  return montarZip(prontas);
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/** As partes do .xlsx que NÃO dependem do conteúdo das linhas (tipos, relações, pasta de trabalho, estilos) e as abas já com nome único. */
function prepararXlsx(sheets: Sheet[]): { named: Sheet[]; fixas: ZipEntry[] } {
  const used = new Set<string>();
  const named = sheets.map((s, i) => {
    const name = safeSheetName(s.name, `Planilha${i + 1}`);
    let n = name;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${name.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return { ...s, name: n };
  });

  // Algum recurso novo em uso? Só então a folha de estilos estendida e o <bookViews> entram no arquivo.
  const estendido = named.some(
    (s) => s.congelarLinhas || s.autoFiltro || s.rows.some((r) => r.some((c) => c.style > 4 || c.kind === "formula")),
  );

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${estendido ? "<bookViews><workbookView/></bookViews>\n" : ""}<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const fixas: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(estendido ? STYLES_XML_EXT : STYLES_XML, "utf8") },
  ];
  return { named, fixas };
}

/** Gera o .xlsx (Buffer) a partir de uma lista de abas. */
export function buildXlsx(sheets: Sheet[], opcoes: OpcoesXlsx = {}): Buffer {
  const { named, fixas } = prepararXlsx(sheets);
  const entries: ZipEntry[] = [...fixas, ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))];
  return buildZip(entries, opcoes.comprimir === true);
}

/**
 * O MESMO arquivo que `buildXlsx` (byte a byte, mesmos `opcoes`), mas sem prender o event loop: cede a cada fatia de 500
 * linhas e entre pedaços do CRC, e o DEFLATE roda no pool de threads do zlib. Uma exportação de 20 mil linhas travava o
 * processo — que também serve o painel, a sincronização e o MCP — por quase 2 segundos de uma vez.
 * Só a central de exportação usa; a exportação por rodada continua no caminho síncrono de sempre.
 */
export async function buildXlsxAsync(sheets: Sheet[], opcoes: OpcoesXlsx = {}, ceder: Ceder = cederPadrao): Promise<Buffer> {
  const { named, fixas } = prepararXlsx(sheets);
  const entries: ZipEntry[] = [...fixas];
  for (let i = 0; i < named.length; i++) {
    const passos = sheetXmlPassos(named[i]!);
    let r = passos.next();
    while (!r.done) {
      await ceder();
      r = passos.next();
    }
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: r.value });
  }
  return buildZipAsync(entries, opcoes.comprimir === true, ceder);
}
