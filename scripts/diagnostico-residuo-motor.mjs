/**
 * Diagnóstico (só leitura) do resíduo "(3) vs (1)" apontado por
 * conferencia-completa.mjs — quando o banco (mesmo sem revisão manual) tem
 * MAIS dinheiro do que um fetch fresco no Conexa mostra pro mesmo filtro.
 *
 * Hipótese a testar: `persistLinhasCategorizadas` (persist.ts) só reavalia
 * "esta linha ainda deveria existir?" para faturas que aparecem no
 * resultado da sincronização ATUAL (`linhas`). Uma fatura que foi aceita e
 * persistida numa rodada anterior, mas que numa rodada posterior deixa de
 * aparecer inteiramente (status mudou pra algo não aceito, ou a Data
 * Crédito foi corrigida/mudou de mês no Conexa), nunca é reavaliada — a
 * linha antiga fica no banco pra sempre, contando dinheiro que o Conexa não
 * reconhece mais pra este período. Isso é DIFERENTE de "órfã" (que já é
 * tratado): órfã é quando a fatura CONTINUA aparecendo mas muda de bucket;
 * este caso é a fatura SUMIR do resultado por completo.
 *
 * Este script busca o export fresco do Conexa (mesmo filtro do motor) e
 * compara, fatura por fatura (crConexaId), contra o que está persistido no
 * banco para o mesmo período — lista quem está num lado e não no outro.
 *
 * Uso: node scripts/diagnostico-residuo-motor.mjs [ano-mes, ex. 2026-07]
 */
import { inflateRawSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const USER_AGENT = "Mozilla/5.0 (compatible; skill-financeiro/1.0)";

const argMes = process.argv[2];
const agora = new Date();
const [ano, mes] = argMes ? argMes.split("-").map(Number) : [agora.getUTCFullYear(), agora.getUTCMonth() + 1];
const periodoInicio = new Date(Date.UTC(ano, mes - 1, 1));
const periodoFimIngestao = argMes ? new Date(Date.UTC(ano, mes, 0)) : new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
const periodoFimBanco = new Date(Date.UTC(ano, mes, 1));

const env = process.env;
if (!env.CONEXA_BASE_URL || !env.CONEXA_WEB_USERNAME || !env.CONEXA_WEB_PASSWORD) {
  console.error("[diagnostico-residuo-motor] ERRO: credenciais do Conexa ausentes no ambiente.");
  process.exit(1);
}

function formatDateBR(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
async function login() {
  const body = new URLSearchParams({
    "LoginForm[username]": env.CONEXA_WEB_USERNAME,
    "LoginForm[password]": env.CONEXA_WEB_PASSWORD,
    "LoginForm[rememberMe]": "0",
    token: "",
  });
  const res = await fetch(`${env.CONEXA_BASE_URL}/index.php?r=site/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body,
    redirect: "manual",
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const cookie = raw.map((h) => /CNXSESSID=[^;,\s]+/.exec(h)?.[0]).find(Boolean);
  if (!cookie || res.status !== 302) throw new Error("login no Conexa falhou");
  return cookie;
}
async function fetchContasReceber(cookie, ini, fim) {
  const params = {
    "Cobranca[id]": "", "Cobranca[statusRegistroBanco]": "", "Cobranca[idCliente][]": "",
    "Cobranca[idRevendedor][]": "", "Cobranca[tipo]": "", "Cobranca[valor]": "",
    "Cobranca[vencFilterFirst]": "", "Cobranca[vencFilterLast]": "",
    "Cobranca[quitacaoFilterFirst]": "", "Cobranca[quitacaoFilterLast]": "",
    "Cobranca[operacaoQuitacaoFilterFirst]": "", "Cobranca[operacaoQuitacaoFilterLast]": "",
    "Cobranca[date_first]": "", "Cobranca[date_last]": "", "Cobranca[imprFilter]": "",
    "Cobranca[emissaoFilterFirst]": "", "Cobranca[emissaoFilterLast]": "",
    "Cobranca[avisosAnteriores]": "", "Cobranca[observacoes]": "", "Cobranca[nossoNumeroBoleto]": "",
    "Cobranca[apenasBoletos]": "", "Cobranca[temAnexo]": "",
    ajax: "cobranca-grid", clearFilters: "0", isFiltering: "1", r: "cobranca/admin",
    searchText: "", show_all: "1", export: "excel",
    "Cobranca[dataCreditoFilterFirst]": formatDateBR(ini),
    "Cobranca[dataCreditoFilterLast]": formatDateBR(fim),
  };
  const url = `${env.CONEXA_BASE_URL}/index.php?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { cookie, "user-agent": USER_AGENT } });
  const contentType = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!contentType.includes("ms-excel") && !contentType.includes("spreadsheet")) {
    throw new Error(`export não retornou xlsx (content-type: ${contentType}) — sessão expirada?`);
  }
  return buf;
}

const EOCD_SIG = 0x06054b50, CDH_SIG = 0x02014b50, LFH_SIG = 0x04034b50;
function findEOCD(b) { const m = Math.min(b.length, 65557), s = b.length - m; for (let i = b.length - 22; i >= s; i--) if (b.readUInt32LE(i) === EOCD_SIG) return i; throw new Error("EOCD"); }
function parseZip(b) {
  const e = findEOCD(b), n = b.readUInt16LE(e + 10), c = b.readUInt32LE(e + 16);
  const m = new Map(); let p = c;
  for (let i = 0; i < n; i++) {
    const meth = b.readUInt16LE(p + 10), cs = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lho = b.readUInt32LE(p + 42), name = b.toString("utf8", p + 46, p + 46 + nl);
    m.set(name, ext(b, lho, meth, cs));
    p += 46 + nl + el + cl;
  }
  return m;
}
function ext(b, lho, meth, cs) { const nl = b.readUInt16LE(lho + 26), el = b.readUInt16LE(lho + 28), ds = lho + 30 + nl + el, c = b.subarray(ds, ds + cs); return meth === 0 ? Buffer.from(c) : inflateRawSync(c); }
function unesc(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
function sharedStrings(xml) { const r = []; const re = /<si>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(xml))) { const p = []; const tre = /<t[^>]*>([\s\S]*?)<\/t>/g; let tm; while ((tm = tre.exec(m[1]))) p.push(unesc(tm[1])); r.push(p.join("")); } return r; }
function colIdx(ref) { const l = /^([A-Z]+)/.exec(ref)?.[1] ?? "A"; let i = 0; for (const ch of l) i = i * 26 + (ch.charCodeAt(0) - 64); return i - 1; }
function sheetRows(xml, sh) {
  const rows = []; const rre = /<row[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rre.exec(xml))) {
    const cells = []; const cre = /<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(rm[1]))) {
      const idx = colIdx(cm[1]), attrs = cm[2] ?? "", inner = cm[3] ?? "", tm = /\bt="([^"]+)"/.exec(attrs), t = tm?.[1];
      let v = "";
      if (t === "s") { const vv = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ""; v = sh[Number(vv)] ?? ""; }
      else if (t === "inlineStr") { v = unesc(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ""); }
      else { v = unesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ""); }
      cells[idx] = v;
    }
    const mi = cells.length - 1; const f = []; for (let i = 0; i <= mi; i++) f.push(cells[i] ?? ""); rows.push(f);
  }
  return rows;
}
function readXlsxAsObjects(buf) {
  const zip = parseZip(buf);
  const sheetXml = zip.get("xl/worksheets/sheet1.xml");
  const sharedXml = zip.get("xl/sharedStrings.xml");
  const sh = sharedXml ? sharedStrings(sharedXml.toString("utf8")) : [];
  const rows = sheetRows(sheetXml.toString("utf8"), sh);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.filter((r) => r.some((c) => c !== "")).map((r) => {
    const o = {}; header.forEach((c, i) => { if (c) o[c] = r[i] ?? ""; }); return o;
  });
}
function parseMoneyCell(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === "") return 0;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s);
}
function parseBR(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s).trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}
function statusAceitoCR(s) { return s.includes("Quitada") || s.includes("Negociação"); }
function dataCreditoNoPeriodo(raw, ini, fim) {
  if (!raw) return null;
  for (const parte of raw.split(",")) {
    const dt = parseBR(parte);
    if (dt && dt.getTime() >= ini.getTime() && dt.getTime() <= fim.getTime()) return dt;
  }
  return null;
}

async function main() {
  console.log("Buscando export fresco do Conexa...");
  const cookie = await login();
  const buf = await fetchContasReceber(cookie, periodoInicio, periodoFimIngestao);
  const objs = readXlsxAsObjects(buf);

  const conexaPorId = new Map();
  for (const o of objs) {
    const id = parseInt(String(o["ID"] ?? "").trim(), 10);
    if (!Number.isFinite(id)) continue;
    if (!statusAceitoCR(o["Status"] || "")) continue;
    const dc = dataCreditoNoPeriodo(o["Data Crédito"], periodoInicio, periodoFimIngestao);
    if (!dc) continue;
    conexaPorId.set(id, { status: o["Status"], valorRecebido: parseMoneyCell(o["Valor Recebido"]), razaoSocial: o["Razão Social Cliente"] });
  }
  console.log(`Conexa aceita agora: ${conexaPorId.size} fatura(s).`);

  console.log("Consultando o banco...");
  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { dataCredito: { gte: periodoInicio, lt: periodoFimBanco } },
  });
  const bancoPorId = new Map();
  for (const l of linhas) {
    const atual = bancoPorId.get(l.crConexaId) ?? { valor: 0, categorias: [], statusPersistido: l.status };
    atual.valor += Number(l.valorRecebidoCat.toString());
    atual.categorias.push(`${l.categoria} (R$${Number(l.valorRecebidoCat.toString()).toFixed(2)})`);
    bancoPorId.set(l.crConexaId, atual);
  }
  console.log(`Banco (dataCredito no período): ${bancoPorId.size} fatura(s) distinta(s), ${linhas.length} linha(s).`);

  const soImportanteNoBanco = [...bancoPorId.keys()].filter((id) => !conexaPorId.has(id));
  const soNoConexa = [...conexaPorId.keys()].filter((id) => !bancoPorId.has(id));

  let valorSoNoBanco = 0;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Faturas no BANCO mas que o Conexa (agora) NÃO aceita mais neste período: ${soImportanteNoBanco.length}`);
  for (const id of soImportanteNoBanco) {
    const b = bancoPorId.get(id);
    valorSoNoBanco += b.valor;
    console.log(`  - CR ${id}: R$${b.valor.toFixed(2)} no banco (status persistido: "${b.statusPersistido}") — categorias: ${b.categorias.join("; ")}`);
  }
  console.log(`  Total: R$ ${valorSoNoBanco.toFixed(2)}`);

  let valorSoNoConexa = 0;
  console.log(`\nFaturas no CONEXA (agora) mas que NÃO estão no banco: ${soNoConexa.length}`);
  for (const id of soNoConexa) {
    const c = conexaPorId.get(id);
    valorSoNoConexa += c.valorRecebido;
    console.log(`  - CR ${id}: R$${c.valorRecebido.toFixed(2)} — "${c.razaoSocial}" (status "${c.status}")`);
  }
  console.log(`  Total: R$ ${valorSoNoConexa.toFixed(2)}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`\nResumo: banco tem R$${valorSoNoBanco.toFixed(2)} a mais (faturas que saíram de cena no Conexa) e R$${valorSoNoConexa.toFixed(2)} a menos (faturas novas que o banco ainda não pegou) — líquido R$${(valorSoNoBanco - valorSoNoConexa).toFixed(2)}.`);
}

main()
  .catch((err) => {
    console.error("[diagnostico-residuo-motor] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
