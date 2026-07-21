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
 */

// ---------------------------------------------------------------------------
// Modelo de célula
// ---------------------------------------------------------------------------

type StyleIndex = 0 | 1 | 2 | 3 | 4;

export interface Cell {
  kind: "text" | "num" | "blank";
  text?: string;
  /** valor numérico como string decimal exata (ex.: "1234.56"); nunca float. */
  num?: string;
  style: StyleIndex;
}

export type Row = Cell[];

export interface Sheet {
  name: string;
  rows: Row[];
  /** larguras de coluna (em "caracteres" do Excel), opcional. */
  colWidths?: number[];
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
  if (cell.kind === "num" && cell.num !== null && cell.num !== undefined) {
    return `<c r="${ref}"${s}><v>${cell.num}</v></c>`;
  }
  if (cell.kind === "text" && cell.text) {
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.text)}</t></is></c>`;
  }
  return `<c r="${ref}"${s}/>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.colWidths?.length
    ? `<cols>${sheet.colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, `${colLetter(c)}${r + 1}`)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  // ⚠ ORDEM IMPORTA: no schema CT_Worksheet do OOXML (ECMA-376), <cols> vem ANTES de
  // <sheetData>. Emitir <cols> depois faz o Excel abrir o arquivo em modo de reparo
  // e descartar as larguras. Por isso `${cols}` precede `<sheetData>`.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
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

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Monta um ZIP com todos os arquivos em STORE (sem compressão). Válido em Excel. */
function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, e.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/** Gera o .xlsx (Buffer) a partir de uma lista de abas. */
export function buildXlsx(sheets: Sheet[]): Buffer {
  const used = new Set<string>();
  const named = sheets.map((s, i) => {
    const name = safeSheetName(s.name, `Planilha${i + 1}`);
    let n = name;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${name.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return { ...s, name: n };
  });

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
<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s), "utf8") })),
  ];

  return buildZip(entries);
}
