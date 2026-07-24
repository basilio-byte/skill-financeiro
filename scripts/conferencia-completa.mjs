/**
 * Conferência completa (só leitura, não corrige nada): compara três números
 * para o mesmo período e explica qualquer diferença entre eles, linha a
 * linha, em vez de deixar como "provavelmente é revisão manual".
 *
 *   1) VERDADE NO CONEXA — busca o export de Contas a Receber direto do
 *      Conexa agora (mesmas credenciais/filtro de conexa-web/client.ts) e
 *      aplica o filtro exato do motor (status aceito + Data Crédito, ver
 *      run.ts/statusAceitoCR/parseDataCreditoNoPeriodo).
 *   2) O QUE ESTÁ NO BANCO HOJE — soma `valorRecebidoCat` de
 *      RevenueCategorizedLine para o mesmo período (dataCredito), a MESMA
 *      consulta que o Panorama usa (src/lib/reports/overview.ts).
 *   3) O QUE A SKILL DIRIA HOJE, SEM REVISÃO MANUAL — igual a (2), mas
 *      trocando o valor de qualquer linha `revisadoManualmente` pelo
 *      `valorRecebidoCatOriginal` dela (o que a skill calculou antes da
 *      revisão, nunca sobrescrito depois — ver financial-rigor.md).
 *
 * (1) e (3) devem SEMPRE bater — se não baterem, tem algo de errado no motor
 * de categorização ou na sincronização (faturas perdidas, filtro errado
 * etc.) e precisa de investigação. A diferença entre (2) e (3) é SEMPRE
 * atribuível a revisões manuais específicas — o script lista cada uma
 * (quem, quando, de quanto pra quanto) para nunca sobrar "diferença sem
 * explicação".
 *
 * Uso: node scripts/conferencia-completa.mjs [ano-mes, ex. 2026-07]
 * Padrão: mês corrente.
 * Rodar em produção via Console do Easypanel.
 */
import { inflateRawSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const USER_AGENT = "Mozilla/5.0 (compatible; skill-financeiro/1.0)";

// --- período ---
const argMes = process.argv[2]; // "2026-07"
const agora = new Date();
const [ano, mes] = argMes
  ? argMes.split("-").map(Number)
  : [agora.getUTCFullYear(), agora.getUTCMonth() + 1];
const periodoInicio = new Date(Date.UTC(ano, mes - 1, 1));
const periodoFimIngestao = argMes ? new Date(Date.UTC(ano, mes, 0)) : new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
const periodoFimBanco = new Date(Date.UTC(ano, mes, 1)); // exclusivo, igual ao Panorama (getPeriodBounds "month")

console.log(`Período: ${periodoInicio.toISOString().slice(0, 10)} a ${periodoFimIngestao.toISOString().slice(0, 10)} (ingestão) / até ${periodoFimBanco.toISOString().slice(0, 10)} exclusivo (banco)\n`);

// --- 1) Conexa, agora ---
// Em produção as variáveis vêm injetadas direto no ambiente pelo Easypanel
// (Secrets), não de um arquivo `.env` no disco — usar process.env direto,
// igual a conexa-web/client.ts.
const env = process.env;
if (!env.CONEXA_BASE_URL || !env.CONEXA_WEB_USERNAME || !env.CONEXA_WEB_PASSWORD) {
  console.error(
    "[conferencia-completa] ERRO: CONEXA_BASE_URL/CONEXA_WEB_USERNAME/CONEXA_WEB_PASSWORD não configurados no ambiente.",
  );
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

// --- leitor de xlsx mínimo (mesma lógica de src/lib/xlsx/reader.ts) ---
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
  console.log("Buscando export de Contas a Receber direto do Conexa...");
  const cookie = await login();
  const buf = await fetchContasReceber(cookie, periodoInicio, periodoFimIngestao);
  const objs = readXlsxAsObjects(buf);

  let somaConexa = 0, countConexa = 0;
  for (const o of objs) {
    if (!statusAceitoCR(o["Status"] || "")) continue;
    const dc = dataCreditoNoPeriodo(o["Data Crédito"], periodoInicio, periodoFimIngestao);
    if (!dc) continue;
    somaConexa += parseMoneyCell(o["Valor Recebido"]);
    countConexa++;
  }

  console.log("Consultando o banco (mesma query do Panorama)...");
  const linhas = await prisma.revenueCategorizedLine.findMany({
    where: { dataCredito: { gte: periodoInicio, lt: periodoFimBanco } },
    include: { revisadoPor: { select: { name: true, email: true } } },
  });

  let somaBanco = 0;
  let somaSkill = 0;
  const revisoes = [];
  for (const l of linhas) {
    const atual = Number(l.valorRecebidoCat.toString());
    somaBanco += atual;
    if (l.revisadoManualmente) {
      const original = l.valorRecebidoCatOriginal ? Number(l.valorRecebidoCatOriginal.toString()) : atual;
      somaSkill += original;
      if (Math.abs(atual - original) > 0.005) {
        revisoes.push({
          crConexaId: l.crConexaId,
          categoria: l.categoria,
          categoriaOriginal: l.categoriaOriginal,
          original,
          atual,
          delta: atual - original,
          por: l.revisadoPor?.name ?? l.revisadoPor?.email ?? "?",
          quando: l.revisadoEm?.toISOString().slice(0, 16) ?? "?",
        });
      }
    } else {
      somaSkill += atual;
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`1) VERDADE NO CONEXA (agora, ${countConexa} fatura(s)):        R$ ${somaConexa.toFixed(2)}`);
  console.log(`2) NO BANCO HOJE (o que o Panorama mostra, ${linhas.length} linha(s)): R$ ${somaBanco.toFixed(2)}`);
  console.log(`3) O QUE A SKILL DIRIA (banco, sem revisão manual):         R$ ${somaSkill.toFixed(2)}`);
  console.log(`${"=".repeat(70)}`);

  const diffMotor = somaSkill - somaConexa;
  const diffRevisao = somaBanco - somaSkill;

  console.log(`\nDiferença (3) vs (1) — engenharia/sincronização: R$ ${diffMotor.toFixed(2)}`);
  if (Math.abs(diffMotor) > 0.02) {
    console.log(`  ⚠️  NÃO deveria haver diferença aqui — investigar (fatura perdida, filtro errado, sincronização desatualizada).`);
  } else {
    console.log(`  ✅ Bate — o motor está processando certo, o banco reflete fielmente o Conexa (fora das revisões manuais).`);
  }

  console.log(`\nDiferença (2) vs (3) — soma de revisões manuais: R$ ${diffRevisao.toFixed(2)}`);
  if (revisoes.length > 0) {
    console.log(`  ${revisoes.length} linha(s) revisada(s) manualmente com valor diferente do calculado pela skill:`);
    for (const r of revisoes) {
      console.log(
        `    - Fatura CR ${r.crConexaId}: "${r.categoriaOriginal ?? "?"}" R$${r.original.toFixed(2)} -> "${r.categoria}" R$${r.atual.toFixed(2)} ` +
          `(${r.delta >= 0 ? "+" : ""}R$${r.delta.toFixed(2)}) por ${r.por} em ${r.quando}`,
      );
    }
  } else {
    console.log(`  Nenhuma revisão manual com valor alterado neste período.`);
  }

  const naoExplicado = somaBanco - somaConexa - revisoes.reduce((a, r) => a + r.delta, 0);
  console.log(`\nResíduo não explicado por revisão manual nenhuma: R$ ${naoExplicado.toFixed(2)}`);
  if (Math.abs(naoExplicado) > 0.02) {
    console.log(`  ⚠️  Isso é dinheiro (ou falta dele) que NENHUMA revisão manual explica — requer investigação.`);
  } else {
    console.log(`  ✅ Tudo explicado — ou é fiel ao Conexa, ou é revisão manual rastreada.`);
  }
}

main()
  .catch((err) => {
    console.error("[conferencia-completa] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
