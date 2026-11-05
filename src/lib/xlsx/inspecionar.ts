import { inflateRawSync } from "node:zlib";

/**
 * Leitor de INSPEÇÃO de um .xlsx gerado por `writer.ts` — várias abas, partes XML cruas, células posicionais.
 *
 * Existe para duas coisas (ADR-0035):
 *  1. testes que precisam ver o que o gerador escreveu (abas, fórmulas, painel congelado);
 *  2. a CONFERÊNCIA de leitura de volta feita pela exportação: depois de montar o arquivo, ele é lido de novo e a
 *     soma da coluna de valores e a contagem de linhas têm de bater com o que o banco devolveu — assim um defeito do
 *     gerador (célula deslocada, XML malformado) vira erro explícito em vez de planilha errada entregue.
 *
 * É propositalmente separado de `reader.ts` (que lê os exports do CONEXA, só a primeira aba): aquele roda no caminho
 * crítico de importação de receita e não deve ser tocado por causa de uma feature de leitura.
 */

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

interface EntradaZip {
  nome: string;
  metodo: number;
  csize: number;
  usize: number;
  local: number;
}

/** O diretório central do ZIP, sem descomprimir nada. */
function catalogo(buf: Buffer): EntradaZip[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx inválido: fim do diretório central não encontrado");
  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entradas: EntradaZip[] = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(ptr) !== CDH_SIG) throw new Error(`xlsx inválido: entrada ${i} do diretório central corrompida`);
    const nomeLen = buf.readUInt16LE(ptr + 28);
    entradas.push({
      nome: buf.toString("utf8", ptr + 46, ptr + 46 + nomeLen),
      metodo: buf.readUInt16LE(ptr + 10),
      csize: buf.readUInt32LE(ptr + 20),
      usize: buf.readUInt32LE(ptr + 24),
      local: buf.readUInt32LE(ptr + 42),
    });
    ptr += 46 + nomeLen + buf.readUInt16LE(ptr + 30) + buf.readUInt16LE(ptr + 32);
  }
  return entradas;
}

/** Descomprime UMA entrada e confere o tamanho contra o do cabeçalho. */
function extrair(buf: Buffer, e: EntradaZip): Buffer {
  if (buf.readUInt32LE(e.local) !== LFH_SIG) throw new Error(`xlsx inválido: cabeçalho local de ${e.nome} corrompido`);
  const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const bruto = buf.subarray(ini, ini + e.csize);
  let dados: Buffer;
  if (e.metodo === 0) dados = Buffer.from(bruto);
  else if (e.metodo === 8) dados = inflateRawSync(bruto);
  else throw new Error(`xlsx inválido: método de compressão ${e.metodo} não suportado`);
  if (dados.length !== e.usize) throw new Error(`xlsx inválido: tamanho de ${e.nome} não confere (${dados.length} ≠ ${e.usize})`);
  return dados;
}

/** Todas as partes do ZIP (nome → bytes já descomprimidos). */
export function lerPartes(buf: Buffer): Map<string, Buffer> {
  return new Map(catalogo(buf).map((e) => [e.nome, extrair(buf, e)]));
}

/** UMA parte do ZIP, descomprimindo só ela (as outras abas, possivelmente enormes, nem são tocadas). */
export function lerParte(buf: Buffer, nome: string): Buffer {
  const e = catalogo(buf).find((x) => x.nome === nome);
  if (!e) throw new Error(`parte ${nome} não encontrada no xlsx`);
  return extrair(buf, e);
}

const desfazerXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** XML cru de uma parte (ex.: "xl/styles.xml"), ou lança se não existir. */
export function lerXml(buf: Buffer, parte: string): string {
  return lerParte(buf, parte).toString("utf8");
}

/** Nomes das abas, na ordem em que o gerador as escreveu (aba i ↔ xl/worksheets/sheet{i+1}.xml). */
export function nomesDasAbas(buf: Buffer): string[] {
  const xml = lerXml(buf, "xl/workbook.xml");
  return [...xml.matchAll(/<sheet name="([^"]*)"/g)].map((m) => desfazerXml(m[1]!));
}

/** Índice (0-based) de "AB" → 27. */
function colunaDe(letras: string): number {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface AbaLida {
  nome: string;
  /** Linhas posicionais (linha 1 = índice 0). Célula vazia = "". Número = o texto de <v>; texto = o texto da célula. */
  linhas: string[][];
}

/** As células do corpo de UMA linha (`<row>…</row>`) como textos posicionais; vazia = "". */
function celulasDaLinha(corpo: string): string[] {
  const celulas: string[] = [];
  // Atributos explícitos: `<c r="A1" s="2"/>` (vazia) nunca pode ser lida como célula com conteúdo.
  const reCel = /<c r="([A-Z]+)(\d+)"((?:\s+[\w:]+="[^"]*")*)\s*(?:\/>|>([\s\S]*?)<\/c>)/g;
  let c: RegExpExecArray | null;
  while ((c = reCel.exec(corpo))) {
    const idx = colunaDe(c[1]!);
    const attrs = c[3] ?? "";
    const dentro = c[4] ?? "";
    const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let valor = "";
    if (tipo === "inlineStr") valor = desfazerXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(dentro)?.[1] ?? "");
    else valor = desfazerXml(/<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1] ?? "");
    celulas[idx] = valor;
  }
  const cheia: string[] = [];
  for (let i = 0; i < celulas.length; i++) cheia.push(celulas[i] ?? "");
  return cheia;
}

function parsearAba(xml: string): string[][] {
  const linhas: string[][] = [];
  const reLinha = /<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m: RegExpExecArray | null;
  while ((m = reLinha.exec(xml))) linhas[Number(m[1]) - 1] = celulasDaLinha(m[2] ?? "");
  for (let i = 0; i < linhas.length; i++) linhas[i] ??= [];
  return linhas;
}

/** Letras de coluna para um índice 0-based (0 → "A", 26 → "AA"). */
function letrasDe(indice: number): string {
  let s = "";
  let n = indice;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Corpo da linha `n` (1-based) de uma aba, ou "" se a linha não existe. */
function corpoDaLinha(xml: string, n: number): string {
  const ini = xml.indexOf(`<row r="${n}">`);
  if (ini < 0) return "";
  const corpoIni = ini + `<row r="${n}">`.length;
  return xml.slice(corpoIni, xml.indexOf("</row>", corpoIni));
}

/**
 * Leitura ENXUTA para a conferência da exportação: só o cabeçalho (linha 1), a coluna de valor das `nLinhas` linhas
 * de dados e o rodapé (linha `nLinhas + 3`), no mesmo formato posicional de `lerAba` — sem materializar as centenas
 * de milhares de células de uma aba grande (que custava ~60 MB e ~2 s por exportação de 24 mil linhas).
 * Só a parte XML da aba pedida é descomprimida.
 */
export function lerParaConferencia(buf: Buffer, nomeAba: string, indiceValor: number, nLinhas: number): string[][] {
  const nomes = nomesDasAbas(buf);
  const i = nomes.indexOf(nomeAba);
  if (i < 0) throw new Error(`aba "${nomeAba}" não encontrada (abas: ${nomes.join(", ")})`);
  // A aba vira string em LATIN1 (1 byte por caractere) em vez de UTF-8 (que viraria UTF-16, o dobro): as marcas XML e os
  // números são ASCII e os bytes de continuação do UTF-8 nunca coincidem com `<`, `>`, `"` ou `&`, então as expressões
  // abaixo funcionam igual. O texto dos poucos trechos que importam é reconvertido para UTF-8 de verdade.
  const xml = lerParte(buf, `xl/worksheets/sheet${i + 1}.xml`).toString("latin1");
  const utf8 = (s: string) => Buffer.from(s, "latin1").toString("utf8");

  const linhas: string[][] = [];
  linhas[0] = celulasDaLinha(utf8(corpoDaLinha(xml, 1)));

  const letra = letrasDe(indiceValor);
  const reValor = new RegExp(`<c r="${letra}(\\d+)"(?:\\s+[\\w:]+="[^"]*")*\\s*(?:/>|>(?:<v>([^<]*)</v>|<is><t[^>]*>([^<]*)</t></is>)</c>)`, "g");
  let m: RegExpExecArray | null;
  while ((m = reValor.exec(xml))) {
    const r = Number(m[1]);
    if (r < 2 || r > nLinhas + 1) continue;
    const linha = (linhas[r - 1] ??= []);
    linha[indiceValor] = m[2] !== undefined ? desfazerXml(m[2]) : desfazerXml(utf8(m[3] ?? ""));
  }
  linhas[nLinhas + 2] = celulasDaLinha(utf8(corpoDaLinha(xml, nLinhas + 3)));
  return linhas;
}

/** Lê UMA aba pelo nome (as demais nem são interpretadas). */
export function lerAba(buf: Buffer, nome: string): AbaLida {
  const nomes = nomesDasAbas(buf);
  const i = nomes.indexOf(nome);
  if (i < 0) throw new Error(`aba "${nome}" não encontrada (abas: ${nomes.join(", ")})`);
  return { nome, linhas: parsearAba(lerXml(buf, `xl/worksheets/sheet${i + 1}.xml`)) };
}

/** Lê todas as abas. */
export function lerPasta(buf: Buffer): AbaLida[] {
  return nomesDasAbas(buf).map((nome, i) => ({ nome, linhas: parsearAba(lerXml(buf, `xl/worksheets/sheet${i + 1}.xml`)) }));
}

/** Quantas linhas (`<row>`) a aba tem, sem materializar célula nenhuma. Serve à conferência de abas sem coluna de valor. */
export function contarLinhasDaAba(buf: Buffer, nomeAba: string): number {
  const nomes = nomesDasAbas(buf);
  const i = nomes.indexOf(nomeAba);
  if (i < 0) throw new Error(`aba "${nomeAba}" não encontrada (abas: ${nomes.join(", ")})`);
  const xml = lerParte(buf, `xl/worksheets/sheet${i + 1}.xml`).toString("latin1");
  let n = 0;
  let pos = xml.indexOf("<row ");
  while (pos >= 0) {
    n += 1;
    pos = xml.indexOf("<row ", pos + 5);
  }
  return n;
}
