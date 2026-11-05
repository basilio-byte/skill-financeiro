import { buildXlsx, buildXlsxAsync, type Sheet } from "@/lib/xlsx/writer";
import { contarLinhasDaAba, lerParaConferencia } from "@/lib/xlsx/inspecionar";
import { conferirLeituraDeVolta } from "./conferencia";
import { gerarCsvConferido } from "./csv";
import { ceder } from "./fila";
import type { EsperadoNaAba } from "./planilha";
import { temCaractereInvalido } from "./texto";
import { ExportacaoInconsistenteError, XLSX_CONTENT_TYPE, type Formato } from "./tipos";

/**
 * Nenhuma célula chega ao gerador com caractere que o XML 1.0 não aceita (controle, U+FFFE/U+FFFF, substituto solto):
 * o Excel abriria o arquivo em "modo de reparo" e descartaria a aba. Todo texto devia ter passado por `textoSeguro`;
 * se algum escapou, é defeito do gerador e o arquivo NÃO é entregue (falha alto, com a aba e a linha).
 */
export function exigirTextoValido(abas: Sheet[]): void {
  const achados: string[] = [];
  for (const aba of abas) {
    for (let r = 0; r < aba.rows.length && achados.length < 3; r++) {
      for (const c of aba.rows[r]!) {
        if (c !== undefined && c.kind === "text" && c.text && temCaractereInvalido(c.text)) {
          achados.push(`aba "${aba.name}", linha ${r + 1}`);
          break;
        }
      }
    }
  }
  if (achados.length) {
    throw new ExportacaoInconsistenteError(`Há texto com caractere inválido para planilha (${achados.join("; ")}): o arquivo não foi entregue.`);
  }
}

/**
 * Confere o arquivo escrito, relido (ADR-0035): o cabeçalho, as linhas e a soma esperados. Defeito do gerador (célula
 * deslocada, número virando texto) vira erro explícito — o arquivo não é entregue.
 */
function conferirArquivo(buffer: Buffer, esperado: EsperadoNaAba[]): void {
  const problemas: string[] = [];
  for (const e of esperado) {
    if (e.indiceValor >= 0) {
      const lido = lerParaConferencia(buffer, e.nomeAba, e.indiceValor, e.nLinhas);
      problemas.push(...conferirLeituraDeVolta(lido, { titulos: e.titulos, nLinhas: e.nLinhas, indiceValor: e.indiceValor, total: e.total ?? "0.00" }).map((p) => `${e.nomeAba}: ${p}`));
    } else {
      // Sem coluna de valor: confere o cabeçalho e o número de linhas (cabeçalho + dados).
      const lido = lerParaConferencia(buffer, e.nomeAba, 0, 0);
      e.titulos.forEach((t, i) => {
        if (lido[0]?.[i] !== t) problemas.push(`${e.nomeAba}: cabeçalho da coluna ${i + 1}: esperado "${t}", lido "${lido[0]?.[i] ?? ""}"`);
      });
      const n = contarLinhasDaAba(buffer, e.nomeAba) - 1;
      if (n < e.nLinhas) problemas.push(`${e.nomeAba}: o arquivo tem ${n} linha(s) de dados, esperado ${e.nLinhas}`);
    }
  }
  if (problemas.length) {
    throw new ExportacaoInconsistenteError(`Conferência de leitura do arquivo não fechou — o arquivo não foi entregue. ${problemas.join("; ")}.`);
  }
}

/** Monta o arquivo (comprimido) e o CONFERE lendo de volta. SÍNCRONO: para testes e ferramentas; a central usa `empacotarAsync`. */
export function empacotar(abas: Sheet[], esperado: EsperadoNaAba[]): Buffer {
  const buffer = buildXlsx(abas, { comprimir: true });
  conferirArquivo(buffer, esperado);
  return buffer;
}

/**
 * O mesmo que `empacotar`, sem prender o event loop (o processo também serve o painel, a sincronização e o MCP): o XML sai
 * em fatias com cessão entre elas, o DEFLATE roda no pool de threads e `ceder()` é também o ponto onde uma exportação
 * cancelada ou fora do prazo PARA. O arquivo é byte a byte o mesmo do caminho síncrono.
 */
export async function empacotarAsync(abas: Sheet[], esperado: EsperadoNaAba[]): Promise<Buffer> {
  const buffer = await buildXlsxAsync(abas, { comprimir: true }, ceder);
  await ceder();
  conferirArquivo(buffer, esperado);
  return buffer;
}

/** O arquivo pronto para entregar: bytes, tipo de conteúdo e extensão. */
export interface Entrega {
  buffer: Buffer;
  contentType: string;
  extensao: "xlsx" | "csv";
}

/**
 * O PONTO ÚNICO de saída de toda exportação (ADR-0035): monta no formato pedido e CONFERE o resultado lendo de volta.
 *
 *  - `xlsx`: todas as abas, comprimido, e cada aba de `esperado` conferida (cabeçalho, linhas, soma).
 *  - `csv`: SÓ a aba principal (`nomeAbaPrincipal`), conferida contra a entrada de `esperado` que tem o mesmo nome.
 *
 * Quem gera um conjunto monta as abas e chama isto — nunca chama `buildXlsx` direto, para não pular a conferência.
 * `esperado` deve incluir a aba principal (com `indiceValor` -1 se ela não tiver coluna de valor que soma).
 */
export function entregar(abas: Sheet[], esperado: EsperadoNaAba[], formato: Formato, nomeAbaPrincipal: string): Entrega {
  if (formato === "csv") {
    const aba = abas.find((a) => a.name === nomeAbaPrincipal);
    if (!aba) throw new ExportacaoInconsistenteError(`A aba principal "${nomeAbaPrincipal}" não existe: não dá para gerar o CSV.`);
    exigirTextoValido([aba]);
    const { buffer, contentType } = gerarCsvConferido(aba, esperado.find((e) => e.nomeAba === nomeAbaPrincipal));
    return { buffer, contentType, extensao: "csv" };
  }
  exigirTextoValido(abas);
  return { buffer: empacotar(abas, esperado), contentType: XLSX_CONTENT_TYPE, extensao: "xlsx" };
}

/**
 * `entregar` para os geradores da central: a mesma conferência e o mesmo arquivo, mas o .xlsx é montado sem prender o
 * event loop. (O CSV é síncrono — uns 0,5 s no teto — e só cede antes de começar.)
 */
export async function entregarAsync(abas: Sheet[], esperado: EsperadoNaAba[], formato: Formato, nomeAbaPrincipal: string): Promise<Entrega> {
  if (formato === "csv") {
    await ceder();
    return entregar(abas, esperado, "csv", nomeAbaPrincipal);
  }
  exigirTextoValido(abas);
  return { buffer: await empacotarAsync(abas, esperado), contentType: XLSX_CONTENT_TYPE, extensao: "xlsx" };
}
