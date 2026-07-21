import { inflateRawSync } from "node:zlib";
import { money, type Money } from "@/lib/money";

/**
 * Leitor de .xlsx SEM depender de biblioteca (simétrico ao writer.ts).
 *
 * Os exports reais do Conexa (tela admin, "Exportar" → excel) vêm como .xlsx
 * de verdade (OOXML/ZIP), comprimidos com DEFLATE — diferente do writer.ts
 * deste projeto, que usa STORE (sem compressão). Por isso este leitor precisa
 * de descompressão de verdade; usamos `node:zlib.inflateRawSync`, que já vem
 * com o Node — nenhuma dependência nova.
 *
 * Escopo deliberadamente pequeno: só o que os exports do Conexa realmente
 * produzem (confirmado inspecionando arquivos reais em 2026-07-21) — uma
 * única aba (`xl/worksheets/sheet1.xml`), sharedStrings.xml, sem células
 * mescladas nem fórmulas. Se um export futuro quebrar essas suposições, a
 * troca por uma lib auditada (ex. exceljs) é um módulo isolado, não um
 * redesenho (ver docs/context/decisions.md).
 */

// ---------------------------------------------------------------------------
// ZIP (central directory) — suporta STORE (0) e DEFLATE (8)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEndOfCentralDirectory(buf: Buffer): number {
  // O EOCD fica no fim do arquivo; procuramos de trás pra frente (comentário
  // opcional pode empurrar a assinatura para antes do EOF).
  const maxBack = Math.min(buf.length, 65_557); // 22 (EOCD) + 65535 (comentário máx.)
  const start = buf.length - maxBack;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("xlsx inválido: assinatura de fim de diretório central (EOCD) não encontrada");
}

function parseZip(buf: Buffer): Map<string, Buffer> {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Buffer>();
  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== CDH_SIG) {
      throw new Error(`xlsx inválido: entrada de diretório central #${i} corrompida`);
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    entries.set(name, extractEntry(buf, localHeaderOffset, method, compressedSize));

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf: Buffer, localHeaderOffset: number, method: number, compressedSize: number): Buffer {
  if (buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
    throw new Error("xlsx inválido: cabeçalho de arquivo local corrompido");
  }
  const nameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`xlsx inválido: método de compressão não suportado (${method})`);
}

// ---------------------------------------------------------------------------
// XML → strings compartilhadas / linhas
// ---------------------------------------------------------------------------

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `xl/sharedStrings.xml` → array de strings (índice = posição no XML). */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(xml))) {
    const body = siMatch[1]!;
    const parts: string[] = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(body))) parts.push(unescapeXml(tMatch[1]!));
    strings.push(parts.join(""));
  }
  return strings;
}

/** Letras de coluna ("A", "AB"...) → índice 0-based. */
function colIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

/** `xl/worksheets/sheet1.xml` → matriz de células (strings cruas, célula vazia = ""). */
function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowBody = rowMatch[1]!;
    const cells: string[] = [];
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowBody))) {
      const ref = cellMatch[1]!;
      const attrs = cellMatch[2] ?? "";
      const inner = cellMatch[3] ?? "";
      const idx = colIndex(ref);
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const type = typeMatch?.[1];

      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        value = shared[Number(v)] ?? "";
      } else if (type === "inlineStr") {
        value = unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "");
      } else if (type === "str" || type === undefined || type === "n") {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }
      cells[idx] = value;
    }
    // preenche buracos (colunas puladas quando vazias) com "" para manter alinhamento posicional.
    const maxIdx = cells.length - 1;
    const filled: string[] = [];
    for (let i = 0; i <= maxIdx; i++) filled.push(cells[i] ?? "");
    rows.push(filled);
  }
  return rows;
}

/** Lê a primeira aba de um .xlsx (Buffer) e devolve linhas de células cruas. */
export function readXlsxRows(buffer: Buffer): string[][] {
  const zip = parseZip(buffer);
  const sheetXml = zip.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("xlsx inválido: xl/worksheets/sheet1.xml não encontrado");

  const sharedXml = zip.get("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml.toString("utf8")) : [];

  return parseSheetRows(sheetXml.toString("utf8"), shared);
}

/**
 * Lê a primeira aba e devolve objetos por linha, usando a primeira linha como
 * cabeçalho (nomes de coluna do próprio export do Conexa). Linhas totalmente
 * vazias são descartadas.
 */
export function readXlsxAsObjects(buffer: Buffer): Array<Record<string, string>> {
  const rows = readXlsxRows(buffer);
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((col, i) => {
        if (col) obj[col] = row[i] ?? "";
      });
      return obj;
    });
}

/**
 * Converte um valor de célula monetária do export do Conexa para `Money`.
 *
 * Bug real já documentado (ver docs/context/financial-rigor.md): o export do
 * Conexa mistura, na MESMA coluna, números <1.000 como float cru ("360.5") e
 * números >=1.000 como texto no formato BR com separador de milhar
 * ("1.328,62") — tratar os dois formatos como "BR" sem distinguir já zerou
 * faturas grandes silenciosamente. Regra: se tem vírgula, é formato BR
 * (ponto = milhar, vírgula = decimal); senão, é número solto (ponto = decimal).
 */
export function parseMoneyCell(raw: string | null | undefined): Money {
  if (raw === null || raw === undefined) return money(0);
  const s = raw.trim();
  if (s === "") return money(0);
  if (s.includes(",")) {
    // formato BR: "1.328,62" → remove separador de milhar, vírgula vira ponto.
    return money(s.replace(/\./g, "").replace(",", "."));
  }
  // já é um número "solto" (ex.: "87.5"); aceita como decimal direto.
  return money(s);
}
