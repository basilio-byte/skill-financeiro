import { readXlsxRows } from "@/lib/xlsx/reader";
import { buildXlsx, T, type Row } from "@/lib/xlsx/writer";

/**
 * Download COMPLETO e CONFERIDO dos exports do Conexa (ADR-0036).
 *
 * Por que existe: em novembro de 2026 o Conexa passou a paginar o export de Contas a Receber (20 linhas por
 * download, `show_all=1` ignorado) e a rodada seguiu "Concluída" com 20 de ~950 cobranças — a limpeza de órfãs
 * apagou o resto do mês. Nada no arquivo avisava que ele estava cortado: o painel só conferia o arquivo contra
 * ele mesmo. A defesa aqui é comparar o que foi BAIXADO com o TOTAL que a própria grade do Conexa informa para o
 * mesmo filtro ("1-20 de 954"), e recusar o download (erro explícito, nada gravado) quando não fecha.
 *
 * Módulo PURO (sem rede, sem `server-only`): quem faz o HTTP é `client.ts`, que injeta `contarTotal` e
 * `baixarPagina`. Assim todo o raciocínio — paginação, linha de preenchimento, repetição, falta, nova tentativa —
 * é testável com fontes falsas, incluindo a que reproduz o defeito de produção.
 */

/** Itens por página aceitos pelo seletor da grade do Conexa: 5, 10, 20, 50 ou 100. Quanto maior, menos requisições. */
export const ITENS_POR_PAGINA_CONTAS_RECEBER = 100;

/**
 * Trava de segurança: um mês real tem ~10 páginas de 100. Se o total informado exigir mais que isto, algo está
 * errado (filtro vazio, grade devolvendo o banco inteiro) e recusamos em vez de baixar milhares de linhas.
 */
export const MAX_PAGINAS = 150;

const TENTATIVAS = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 2_000;

/** O download não fecha com o total que o Conexa informa (ou veio com estrutura inesperada). Nada deve ser gravado. */
export class ExportIncompletoError extends Error {}

// ---------------------------------------------------------------------------
// Leitura do total na grade HTML
// ---------------------------------------------------------------------------

/**
 * O total de itens do filtro, lido do resumo da grade que o Conexa devolve com o parâmetro `count` — `<div
 * class="page-summary"><div>1-20 de 954</div></div>`. Medido contra o Conexa real em 2026-11-11: bate com as
 * linhas do export de Contas a Receber e do Listar Vendas (e com `linhasCR` de rodadas antigas, de quando o
 * export ainda vinha inteiro).
 *
 * `0` quando a grade está vazia (`<td class="empty">`, sem resumo). `null` quando a resposta NÃO é a grade
 * esperada — login expirado, página de erro, marcação que mudou. Quem chama deve tratar `null` como erro, nunca
 * como zero: ler "nenhuma cobrança" de uma página que não é a grade esconderia o mesmo defeito que isto previne.
 */
export function extrairTotalDaGrade(html: string, idGrade: string): number | null {
  if (!html.includes(`id="${idGrade}"`)) return null;
  const resumo = /class="[^"]*\bpage-summary\b[^"]*"/.exec(html);
  if (resumo) {
    const texto = html.slice(resumo.index, resumo.index + 400).replace(/<[^>]*>/g, " ");
    // "1-20 de 954"; um único item pode vir sem o intervalo ("1 de 1").
    const m = /(?:\d[\d.]*\s*-\s*\d[\d.]*\s+|\b)de\s+(\d[\d.]*)/.exec(texto);
    if (!m) return null;
    const n = Number(m[1]!.replace(/\./g, ""));
    return Number.isSafeInteger(n) ? n : null;
  }
  return /<td[^>]*class="[^"]*\bempty\b[^"]*"/.test(html) ? 0 : null;
}

// ---------------------------------------------------------------------------
// Leitura e montagem do xlsx
// ---------------------------------------------------------------------------

/**
 * O export de Contas a Receber termina cada página com uma linha de preenchimento (`&nbsp;` e células vazias,
 * 20 colunas contra as 38 do cabeçalho). Não é cobrança: contá-la inflaria o total e criaria uma "fatura" de ID 0.
 */
export function ehLinhaDePreenchimento(linha: string[]): boolean {
  return linha.every((c) => {
    const t = c.replace(/ /g, " ").trim();
    return t === "" || t === "&nbsp;";
  });
}

export interface ExportLido {
  cabecalho: string[];
  /** Linhas de dados, SEM a de preenchimento. */
  dados: string[][];
}

export function lerExport(buffer: Buffer): ExportLido {
  const [cabecalho, ...corpo] = readXlsxRows(buffer);
  if (!cabecalho || cabecalho.every((c) => !c.trim())) {
    throw new ExportIncompletoError("O export do Conexa veio sem linha de cabeçalho.");
  }
  return { cabecalho, dados: corpo.filter((l) => !ehLinhaDePreenchimento(l)) };
}

/**
 * Remonta UM .xlsx a partir do cabeçalho e das linhas já conferidas. Cada célula entra como TEXTO com a string
 * crua que o leitor viu (`"1.328,62"`, `"360.5"`, `"32616.0"`): é exatamente o que `readXlsxAsObjects` entrega ao
 * parser quando lê o arquivo original — o contrato do Conexa (números soltos misturados a texto BR) continua
 * sendo resolvido em `parseMoneyCell`, não aqui.
 *
 * Célula VAZIA é OMITIDA (buraco na linha), nunca escrita como `<c r="D3"/>`: o leitor do projeto (reader.ts) lê
 * errado uma célula autofechada seguida de outra — ela "engole" a vizinha. Os exports do Conexa não têm nenhuma
 * (0 em ~41 mil células medidas em 2026-11-11: o Conexa também omite as vazias), então o leitor nunca precisou
 * disso; o teste de ida e volta trava que este arquivo também não tenha.
 */
export function montarXlsx(nomeDaAba: string, cabecalho: string[], linhas: string[][]): Buffer {
  const esparsa = (l: string[]): Row => {
    const celulas: Row = [];
    l.forEach((c, i) => {
      if (c !== "") celulas[i] = T(c);
    });
    return celulas;
  };
  return buildXlsx([{ name: nomeDaAba, rows: [esparsa(cabecalho), ...linhas.map(esparsa)] }], { comprimir: true });
}

// ---------------------------------------------------------------------------
// Coleta conferida
// ---------------------------------------------------------------------------

export interface OpcoesColeta {
  /** Nome do export nas mensagens ("Contas a Receber"). */
  rotulo: string;
  /** Total de itens do filtro segundo a grade do Conexa (a conferência independente). */
  contarTotal: () => Promise<number>;
  /** Baixa UMA página (1-based) e devolve o .xlsx cru. */
  baixarPagina: (pagina: number) => Promise<Buffer>;
  /** Linhas por página. Sem isto o export vem inteiro numa só requisição (Listar Vendas). */
  itensPorPagina?: number;
  /** Coluna que identifica a linha; liga a detecção de repetição entre páginas. */
  colunaId?: string;
  /** Troca o `setTimeout` nos testes. */
  esperar?: (ms: number) => Promise<void>;
  log?: (mensagem: string) => void;
}

export interface ExportColetado {
  cabecalho: string[];
  /** Linhas conferidas, sem preenchimento nem repetição, na ordem do Conexa. */
  linhas: string[][];
  paginas: number;
  /** O total que a grade do Conexa informou (a conferência). */
  totalNoConexa: number;
  tentativas: number;
  /** Só quando o export veio numa ÚNICA requisição: o arquivo exatamente como o Conexa entregou. */
  bufferOriginal?: Buffer;
}

const mesmoCabecalho = (a: string[], b: string[]) => {
  const corta = (x: string[]) => {
    const c = [...x];
    while (c.length && !c[c.length - 1]!.trim()) c.pop();
    return JSON.stringify(c);
  };
  return corta(a) === corta(b);
};

/** "32616.0" e "32616" são a mesma fatura. */
function chaveDoId(valor: string | undefined): string {
  const t = (valor ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? String(n) : t;
}

type Tentativa = { ok: true; coletado: ExportColetado } | { ok: false; motivo: string };

async function tentarUmaVez(opcoes: OpcoesColeta, tentativa: number): Promise<Tentativa> {
  const { rotulo, itensPorPagina, colunaId } = opcoes;
  const total = await opcoes.contarTotal();
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ExportIncompletoError(`${rotulo}: o total informado pelo Conexa (${String(total)}) não é um número válido.`);
  }
  // Mesmo com total 0 baixa-se a primeira página: é dela que vem o cabeçalho, e ela também denuncia um total errado.
  const paginasEsperadas = itensPorPagina ? Math.max(1, Math.ceil(total / itensPorPagina)) : 1;
  if (paginasEsperadas > MAX_PAGINAS) {
    throw new ExportIncompletoError(
      `${rotulo}: o filtro tem ${total} itens, o que exigiria ${paginasEsperadas} páginas (limite de segurança: ${MAX_PAGINAS}). ` +
        "Confira o período pedido.",
    );
  }

  let cabecalho: string[] | null = null;
  let iId = -1;
  const linhas: string[][] = [];
  const vistos = new Set<string>();
  let repetidas = 0;
  let paginas = 0;
  let bufferOriginal: Buffer | undefined;

  for (let pagina = 1; pagina <= paginasEsperadas; pagina++) {
    const buf = await opcoes.baixarPagina(pagina);
    paginas += 1;
    const lido = lerExport(buf);
    if (cabecalho === null) {
      cabecalho = lido.cabecalho;
      if (colunaId) {
        iId = cabecalho.indexOf(colunaId);
        if (iId < 0) {
          throw new ExportIncompletoError(`${rotulo}: o export do Conexa não tem a coluna "${colunaId}" — o formato mudou.`);
        }
      }
      if (paginasEsperadas === 1) bufferOriginal = buf;
    } else if (!mesmoCabecalho(cabecalho, lido.cabecalho)) {
      throw new ExportIncompletoError(`${rotulo}: o cabeçalho do export mudou entre a página 1 e a ${pagina} — o formato mudou durante o download.`);
    }
    for (const linha of lido.dados) {
      if (colunaId) {
        const chave = chaveDoId(linha[iId]);
        if (vistos.has(chave)) {
          repetidas += 1;
          continue;
        }
        vistos.add(chave);
      }
      linhas.push(linha);
    }
    // Já temos tudo: não adianta pedir as páginas restantes (ex.: o Conexa voltou a honrar `show_all` e a primeira
    // página já veio inteira — pedir a segunda só traria as mesmas linhas de novo).
    if (linhas.length >= total && pagina >= 1 && repetidas === 0) break;
  }

  if (cabecalho === null) throw new ExportIncompletoError(`${rotulo}: nenhuma página foi baixada.`);

  if (repetidas > 0) {
    return {
      ok: false,
      motivo: `${repetidas} linha(s) apareceram em mais de uma página (o conjunto mudou durante o download)`,
    };
  }
  if (linhas.length < total) {
    return {
      ok: false,
      motivo: `a grade do Conexa informa ${total} item(ns) para este filtro e o download trouxe ${linhas.length} (${paginas} página(s))`,
    };
  }
  if (linhas.length > total) {
    // Entrou algo novo entre a contagem e o download: sobra, nunca falta — seguro aceitar.
    opcoes.log?.(`${rotulo}: ${linhas.length} linhas baixadas para um total informado de ${total} (entrou item novo durante o download).`);
  }
  return {
    ok: true,
    coletado: { cabecalho, linhas, paginas, totalNoConexa: total, tentativas: tentativa, bufferOriginal: paginas === 1 ? bufferOriginal : undefined },
  };
}

/**
 * Baixa o export inteiro, página a página, e só o entrega quando o que veio FECHA com o total que a grade do
 * Conexa informa para o mesmo filtro. Divergência (faltou linha, linha repetida porque o conjunto mudou no meio
 * do download) é tentada de novo até `TENTATIVAS` vezes — o Conexa é ao vivo e uma cobrança pode entrar entre as
 * requisições —, e depois vira `ExportIncompletoError`: a rodada falha e NADA é gravado. Falhar alto é a
 * propriedade que importa; o defeito de novembro foi justamente concluir em silêncio com dado cortado.
 *
 * Só FALTA reprova. Sobra (entrou cobrança nova durante o download) é aceita: os dados são um superconjunto.
 */
export async function coletarExportCompleto(opcoes: OpcoesColeta): Promise<ExportColetado> {
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ultimoMotivo = "";
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const r = await tentarUmaVez(opcoes, tentativa);
    if (r.ok) return r.coletado;
    ultimoMotivo = r.motivo;
    opcoes.log?.(`${opcoes.rotulo}: tentativa ${tentativa}/${TENTATIVAS} não fechou — ${r.motivo}.`);
    if (tentativa < TENTATIVAS) await esperar(ESPERA_ENTRE_TENTATIVAS_MS * tentativa);
  }
  throw new ExportIncompletoError(
    `Export de ${opcoes.rotulo} do Conexa INCOMPLETO após ${TENTATIVAS} tentativas: ${ultimoMotivo}. ` +
      "Nada foi gravado — os dados do painel continuam como estavam. Se persistir, use Sincronizações → Importar arquivos do Conexa.",
  );
}
