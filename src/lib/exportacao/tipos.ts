/**
 * Tipos compartilhados da CENTRAL DE EXPORTAÇÃO (ADR-0035). Puro: sem banco, sem Next.
 */

export type Formato = "xlsx" | "csv";

export type Papel = "ADMIN" | "VIEWER";

/** Quem está exportando — o suficiente para a aba Leia-me, as permissões e o log. */
export interface UsuarioExport {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
}

/**
 * Como o valor de uma coluna vira célula:
 *  - `id`: número sem formatação (nº de fatura: nunca "29.113");
 *  - `dinheiro`: R$, numérico exato (o Excel soma);
 *  - `data` / `datahora`: data de verdade (o Excel ordena e filtra);
 *  - `texto`: sempre texto, nunca interpretado como número/fórmula.
 */
export type TipoColuna = "texto" | "id" | "inteiro" | "dinheiro" | "data" | "datahora" | "percentual";

export interface ColunaDef<L> {
  id: string;
  titulo: string;
  /** Id do grupo de colunas (ver GrupoDef). */
  grupo: string;
  tipo: TipoColuna;
  /** Largura em "caracteres" do Excel. */
  largura: number;
  /** Valor cru da célula. `dinheiro` devolve string decimal ("1234.56"), `data` devolve Date UTC, `datahora` devolve relógio de parede. */
  valor: (linha: L) => string | number | Date | null | undefined;
  /**
   * Os campos da linha que `valor` LÊ. Só estes são buscados no banco: ler todas as colunas de 24 mil linhas custa
   * centenas de MB (cada coluna de dinheiro vira um objeto Decimal). Um teste prova que `valor` não lê nada além disto.
   */
  campos: readonly string[];
}

export interface GrupoDef {
  id: string;
  rotulo: string;
  descricao: string;
  /** Dados pessoais / texto livre: só administrador pede (o servidor recusa com 403, não omite em silêncio). */
  somenteAdmin: boolean;
  /** Vem marcado por padrão no formulário. */
  padrao: boolean;
  /** Sempre presente: o formulário mostra marcado e travado. */
  fixo?: boolean;
}

export interface ResultadoExportacao {
  buffer: Buffer;
  nomeArquivo: string;
  contentType: string;
  /** Linhas de DADOS do detalhe principal. */
  linhas: number;
  /** Soma da coluna de valor do detalhe ("1234.56"), quando o conjunto tem uma. */
  total: string | null;
  /** O que saiu na aba Leia-me: pares campo/valor, em português. */
  filtros: Array<[string, string]>;
  /** A exportação incluiu dados pessoais (CPF/CNPJ, contato, texto livre)? Entra no log. */
  dadosPessoais: boolean;
  /** Filtros normalizados, para reproduzir o recorte depois (log). */
  filtrosJson: unknown;
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/** Pedido inválido (filtro mal formado…): 400 com a lista do que corrigir. */
export class ExportacaoInvalidaError extends Error {
  readonly erros: string[];
  constructor(erros: string[]) {
    super(erros.join(" "));
    this.name = "ExportacaoInvalidaError";
    this.erros = erros;
  }
}

/** A pessoa não pode pedir isto (conjunto ou grupo de colunas só de administrador): 403. */
export class ExportacaoNegadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ExportacaoNegadaError";
  }
}

/** O recorte passou do teto de linhas: 422, com o que fazer. */
export class ExportacaoGrandeDemaisError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ExportacaoGrandeDemaisError";
  }
}

/** Já há exportações demais em andamento neste servidor: 503, com o que fazer. */
export class ExportacaoOcupadaError extends Error {
  constructor() {
    super("Há várias exportações em andamento neste momento. Aguarde alguns segundos e tente de novo.");
    this.name = "ExportacaoOcupadaError";
  }
}

/** O navegador desconectou antes de o arquivo ficar pronto (aba fechada, clique repetido): ninguém vai receber, então para. */
export class ExportacaoCanceladaError extends Error {
  constructor() {
    super("A exportação foi cancelada porque o navegador desconectou antes de o arquivo ficar pronto.");
    this.name = "ExportacaoCanceladaError";
  }
}

/** A conferência interna não fechou (soma, contagem, leitura de volta): 500. O arquivo NÃO é entregue. */
export class ExportacaoInconsistenteError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ExportacaoInconsistenteError";
  }
}

/** Teto de linhas por exportação: protege a memória do servidor e o Excel de quem abre. */
export const MAX_LINHAS = 20_000;
