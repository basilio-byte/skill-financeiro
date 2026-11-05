import { toZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/dates";
import { money, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import { BLANK, BRL, BRLB, D, DT, FBRL, H, HX, HXR, INT, INTB, N, PCT, PCTB, T, W, WB, type Cell, type Sheet } from "@/lib/xlsx/writer";
import { textoSeguro } from "./texto";
import type { ColunaDef, TipoColuna } from "./tipos";

/**
 * Montagem das ABAS de uma exportação (ADR-0035). PURO: recebe linhas já lidas, devolve `Sheet`s. Nada de banco.
 *
 * Todo dinheiro daqui é `Money` (decimal.js) ou string decimal exata — nunca `number` somado. Os números entram no
 * arquivo como NÚMERO de verdade (o Excel soma), formatados como R$ só na apresentação.
 */

// ---------------------------------------------------------------------------------------------------------------
// Data e hora
// ---------------------------------------------------------------------------------------------------------------

/**
 * Instante → relógio de parede do fuso do app, guardado nos campos UTC de um `Date` (é o que `DT` espera: o Excel
 * não tem fuso). `toZonedTime` devolve um Date cujos getters LOCAIS são o relógio do fuso pedido.
 */
export function paraParede(d: Date): Date {
  const z = toZonedTime(d, APP_TZ);
  return new Date(Date.UTC(z.getFullYear(), z.getMonth(), z.getDate(), z.getHours(), z.getMinutes(), z.getSeconds()));
}

/** "04/11/2026 17:53", no fuso do app. */
export function dataHoraBr(d: Date): string {
  return d
    .toLocaleString("pt-BR", { timeZone: APP_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .replace(",", "");
}

// ---------------------------------------------------------------------------------------------------------------
// Célula a partir do tipo da coluna
// ---------------------------------------------------------------------------------------------------------------

/** Cabeçalho da coluna: à direita quando a coluna é numérica (o título fica sobre os números), à esquerda quando é texto. */
export function cabecalhoDe(tipo: TipoColuna, titulo: string): Cell {
  return tipo === "texto" ? HX(titulo) : HXR(titulo);
}

export function celulaDe(tipo: TipoColuna, valor: string | number | Date | null | undefined): Cell {
  if (valor === null || valor === undefined || valor === "") return BLANK;
  switch (tipo) {
    case "texto":
      return T(textoSeguro(valor));
    case "id":
      return N(typeof valor === "number" ? valor : String(valor));
    case "inteiro":
      return INT(typeof valor === "number" ? valor : String(valor));
    case "dinheiro":
      return BRL(String(valor));
    case "data":
      return D(valor instanceof Date ? valor : null);
    case "datahora":
      return DT(valor instanceof Date ? valor : null);
    case "percentual":
      return PCT(String(valor));
  }
}

/** Letras de coluna do Excel para um índice 0-based (0 → "A", 26 → "AA"). */
export function letraDaColuna(indice: number): string {
  let s = "";
  let n = indice;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Aba de detalhe (uma linha por registro)
// ---------------------------------------------------------------------------------------------------------------

export interface OpcoesDetalhe<L> {
  nome: string;
  colunas: ColunaDef<L>[];
  linhas: L[];
  /** Id da coluna (tipo `dinheiro`) cuja soma vira a linha TOTAL no rodapé. */
  colunaTotal?: string;
}

export interface Detalhe {
  aba: Sheet;
  /** Soma da `colunaTotal` calculada AQUI, linha a linha, com decimal exato ("1234.56"); null sem coluna de total. */
  total: string | null;
  /** Índice (0-based) da coluna de total no arquivo, ou -1. */
  indiceColunaTotal: number;
  /** Linhas de dados começam na linha 2 (a 1 é o cabeçalho) e vão até `ultimaLinhaDados` (1-based). */
  ultimaLinhaDados: number;
}

/**
 * Cabeçalho destacado e congelado, autofiltro e larguras. O TOTAL fica DEPOIS de uma linha em branco e FORA da faixa
 * do autofiltro: ordenar ou filtrar pelo Excel não o arrasta para o meio dos dados.
 */
export function abaDeDetalhe<L>(o: OpcoesDetalhe<L>): Detalhe {
  const cabecalho = o.colunas.map((c) => cabecalhoDe(c.tipo, c.titulo));
  const corpo = o.linhas.map((l) => o.colunas.map((c) => celulaDe(c.tipo, c.valor(l))));
  const rows: Cell[][] = [cabecalho, ...corpo];

  let total: string | null = null;
  let indice = -1;
  if (o.colunaTotal) {
    indice = o.colunas.findIndex((c) => c.id === o.colunaTotal);
    if (indice >= 0) {
      const col = o.colunas[indice]!;
      total = toAmountString(sum(o.linhas.map((l) => String(col.valor(l) ?? "0"))));
      const rodape: Cell[] = o.colunas.map(() => BLANK);
      rodape[0] = H("TOTAL");
      // O total ACOMPANHA o filtro do Excel: SUBTOTAL(109) soma só as linhas visíveis (as filtradas ficam de fora). O valor
      // em cache é o total exato calculado aqui, então quem abre o arquivo sem recalcular vê o número certo.
      const letra = letraDaColuna(indice);
      rodape[indice] = o.linhas.length > 0 ? FBRL(`SUBTOTAL(109,${letra}2:${letra}${o.linhas.length + 1})`, total) : BRLB(total);
      rows.push([], rodape);
    }
  }

  return {
    aba: {
      name: o.nome,
      rows,
      colWidths: o.colunas.map((c) => c.largura),
      congelarLinhas: 1,
      autoFiltro: { primeiraLinha: 1, ultimaLinha: 1 + o.linhas.length, ultimaColuna: o.colunas.length - 1 },
    },
    total,
    indiceColunaTotal: indice,
    ultimaLinhaDados: 1 + o.linhas.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Resumos (agrupamentos)
// ---------------------------------------------------------------------------------------------------------------

export interface GrupoResumo {
  chave: string;
  linhas: number;
  /** Faturas DISTINTAS dentro do grupo. */
  faturas: number;
  valor: Money;
}

export interface TotalResumo {
  linhas: number;
  faturas: number;
  valor: Money;
}

/** Soma e conta por chave. Ordem: maior valor primeiro (empate: chave), ou pela chave quando `ordem: "chave"`. */
export function agrupar<L>(
  linhas: L[],
  chaveDe: (l: L) => string,
  valorDe: (l: L) => string,
  faturaDe: (l: L) => number,
  ordem: "valor" | "chave" = "valor",
): GrupoResumo[] {
  const mapa = new Map<string, { linhas: number; faturas: Set<number>; valor: Money }>();
  for (const l of linhas) {
    const k = chaveDe(l);
    const g = mapa.get(k) ?? { linhas: 0, faturas: new Set<number>(), valor: ZERO };
    g.linhas += 1;
    g.faturas.add(faturaDe(l));
    g.valor = g.valor.plus(money(valorDe(l)));
    mapa.set(k, g);
  }
  const grupos = [...mapa.entries()].map(([chave, g]) => ({ chave, linhas: g.linhas, faturas: g.faturas.size, valor: g.valor }));
  grupos.sort((a, b) =>
    ordem === "chave" ? a.chave.localeCompare(b.chave, "pt-BR") : b.valor.comparedTo(a.valor) || a.chave.localeCompare(b.chave, "pt-BR"),
  );
  return grupos;
}

/** Totais gerais de um conjunto de linhas (faturas DISTINTAS no conjunto todo, não a soma por grupo). */
export function totalGeral<L>(linhas: L[], valorDe: (l: L) => string, faturaDe: (l: L) => number): TotalResumo {
  return { linhas: linhas.length, faturas: new Set(linhas.map(faturaDe)).size, valor: sum(linhas.map(valorDe)) };
}

const pct = (parte: Money, todo: Money): string => (todo.isZero() ? "0.00" : parte.div(todo).times(100).toFixed(2));

export interface OpcoesResumo {
  nome: string;
  tituloChave: string;
  grupos: GrupoResumo[];
  total: TotalResumo;
  /** A chave é "aaaa-mm-dd": vira data de verdade. */
  chaveEhData?: boolean;
}

export function abaDeResumo(o: OpcoesResumo): Sheet {
  const rows: Cell[][] = [[HX(o.tituloChave), HXR("Linhas"), HXR("Faturas (distintas)"), HXR("Valor Recebido Cat."), HXR("% do total")]];
  for (const g of o.grupos) {
    // Chave de data só vira data de verdade quando É uma data (ex.: "(sem data)" continua texto).
    const chave = o.chaveEhData && /^\d{4}-\d{2}-\d{2}$/.test(g.chave) ? D(new Date(`${g.chave}T00:00:00.000Z`)) : T(textoSeguro(g.chave));
    rows.push([chave, INT(g.linhas), INT(g.faturas), BRL(toAmountString(g.valor)), PCT(pct(g.valor, o.total.valor))]);
  }
  rows.push([H("TOTAL"), INTB(o.total.linhas), INTB(o.total.faturas), BRLB(toAmountString(o.total.valor)), PCTB("100.00")]);
  rows.push([]);
  rows.push([W("Uma fatura rateada aparece em mais de uma linha e pode aparecer em mais de um grupo: por isso a coluna Faturas não soma. Só 'Valor Recebido Cat.' soma.")]);
  return { name: o.nome, rows, colWidths: [46, 11, 19, 22, 12], congelarLinhas: 1 };
}

/** Soma dos valores de um resumo (para a conferência: tem de bater com o total do detalhe). */
export function somaDoResumo(grupos: GrupoResumo[]): Money {
  return grupos.reduce<Money>((acc, g) => acc.plus(g.valor), ZERO);
}

// ---------------------------------------------------------------------------------------------------------------
// Matriz linha × coluna (ex.: categoria × mês)
// ---------------------------------------------------------------------------------------------------------------

export interface Matriz {
  aba: Sheet;
  /** Soma de todas as células, para a conferência. */
  total: Money;
  colunas: string[];
}

export function abaMatriz<L>(o: {
  nome: string;
  tituloLinha: string;
  linhas: L[];
  linhaDe: (l: L) => string;
  colunaDe: (l: L) => string;
  valorDe: (l: L) => string;
}): Matriz {
  const colunas = [...new Set(o.linhas.map(o.colunaDe))].sort();
  const mapa = new Map<string, Map<string, Money>>();
  for (const l of o.linhas) {
    const lk = o.linhaDe(l);
    const ck = o.colunaDe(l);
    const linha = mapa.get(lk) ?? new Map<string, Money>();
    linha.set(ck, (linha.get(ck) ?? ZERO).plus(money(o.valorDe(l))));
    mapa.set(lk, linha);
  }
  const totalDaLinha = (m: Map<string, Money>) => [...m.values()].reduce<Money>((a, v) => a.plus(v), ZERO);
  const ordenadas = [...mapa.entries()].sort(
    (a, b) => totalDaLinha(b[1]).comparedTo(totalDaLinha(a[1])) || a[0].localeCompare(b[0], "pt-BR"),
  );

  const rows: Cell[][] = [[HX(o.tituloLinha), ...colunas.map((c) => HXR(c)), HXR("Total")]];
  const totaisColuna = new Map<string, Money>(colunas.map((c) => [c, ZERO]));
  let geral = ZERO;
  for (const [lk, m] of ordenadas) {
    const cels: Cell[] = [T(textoSeguro(lk))];
    for (const c of colunas) {
      const v = m.get(c);
      if (v && !v.isZero()) {
        cels.push(BRL(toAmountString(v)));
        totaisColuna.set(c, totaisColuna.get(c)!.plus(v));
      } else cels.push(BLANK);
    }
    const t = totalDaLinha(m);
    geral = geral.plus(t);
    cels.push(BRLB(toAmountString(t)));
    rows.push(cels);
  }
  rows.push([H("TOTAL"), ...colunas.map((c) => BRLB(toAmountString(totaisColuna.get(c)!))), BRLB(toAmountString(geral))]);
  return {
    aba: { name: o.nome, rows, colWidths: [46, ...colunas.map(() => 16), 18], congelarLinhas: 1 },
    total: geral,
    colunas,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Aba Leia-me
// ---------------------------------------------------------------------------------------------------------------

export interface DadosLeiaMe {
  titulo: string;
  geradoEm: Date;
  /** "Nome (email)". */
  geradoPor: string;
  filtros: Array<[string, string]>;
  resultado: Array<[string, string]>;
  /** Frase pronta sobre a atualidade dos dados; `alerta` destaca quando algo está errado ou defasado. */
  frescor: { texto: string; alerta: boolean };
  avisos: string[];
  conferencia: string;
}

/**
 * A aba que acompanha o arquivo por onde ele for (e-mail, WhatsApp, pasta compartilhada): o recorte, a hora, a
 * atualidade dos dados e como ler os números. Sem ela, uma planilha de receita vira um número sem origem.
 */
export function abaLeiaMe(d: DadosLeiaMe): Sheet {
  const rows: Cell[][] = [];
  // TUDO que entra aqui passa por `textoSeguro`: filtros digitados, nome de quem gerou, mensagens do sistema. Um caractere
  // de controle num só destes textos deixaria o XML mal formado e o Excel abriria o arquivo em "modo de reparo".
  // O rótulo (coluna A) quebra linha em vez de ser cortado pelo valor ao lado.
  const linha = (campo: string, valor: string) => rows.push([WB(textoSeguro(campo)), W(textoSeguro(valor))]);
  const titulo = (t: string) => rows.push([HX(textoSeguro(t)), HX("")]);

  rows.push([H(textoSeguro(d.titulo))]);
  rows.push([]);
  linha("Gerado em", dataHoraBr(d.geradoEm));
  linha("Gerado por", d.geradoPor);
  rows.push([]);
  titulo("Filtros aplicados");
  for (const [k, v] of d.filtros) linha(k, v);
  rows.push([]);
  titulo("Resultado");
  for (const [k, v] of d.resultado) linha(k, v);
  rows.push([]);
  titulo("Atualidade dos dados");
  linha(d.frescor.alerta ? "ATENÇÃO" : "Situação", d.frescor.texto);
  rows.push([]);
  titulo("Como ler esta planilha");
  d.avisos.forEach((a, i) => linha(`Atenção ${i + 1}`, a));
  rows.push([]);
  titulo("Conferência");
  linha("Fechamento", d.conferencia);
  return { name: "Leia-me", rows, colWidths: [44, 112] };
}

// ---------------------------------------------------------------------------------------------------------------
// Tabela genérica (resumos e conjuntos pequenos) e empacotamento conferido
// ---------------------------------------------------------------------------------------------------------------

export interface ColunaTabela {
  titulo: string;
  tipo: TipoColuna;
  largura: number;
}

export interface OpcoesTabela {
  nome: string;
  colunas: ColunaTabela[];
  /** Valores na ordem das colunas. */
  linhas: Array<Array<string | number | Date | null | undefined>>;
  /** Linha TOTAL (mesma largura das colunas): o primeiro valor vira o rótulo, os demais sem formato próprio de texto. */
  total?: Array<string | number | null | undefined>;
  /** Texto explicativo abaixo da tabela. */
  nota?: string;
  /** Autofiltro sobre as linhas de dados (padrão: sim). */
  autoFiltro?: boolean;
}

function celulaDeTotal(tipo: TipoColuna, valor: string | number | null | undefined, primeira: boolean): Cell {
  if (valor === null || valor === undefined || valor === "") return BLANK;
  if (primeira) return H(textoSeguro(valor));
  switch (tipo) {
    case "dinheiro":
      return BRLB(String(valor));
    case "inteiro":
    case "id":
      return INTB(String(valor));
    case "percentual":
      return PCTB(String(valor));
    default:
      return H(textoSeguro(valor));
  }
}

/**
 * Quebra um texto em linhas de até `max` caracteres, só entre palavras (uma palavra maior que `max` é cortada). A nota
 * de uma aba vai assim, uma linha por linha, SEM quebra automática: o texto transborda sobre as células vazias da
 * direita em vez de virar uma faixa de 25 linhas espremida numa coluna estreita.
 */
export function quebrarEmLinhas(texto: string, max = 110): string[] {
  const saida: string[] = [];
  for (const paragrafo of texto.split(/\r?\n/)) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      let p = palavra;
      while (p.length > max) {
        if (atual) {
          saida.push(atual);
          atual = "";
        }
        saida.push(p.slice(0, max));
        p = p.slice(max);
      }
      if (!atual) atual = p;
      else if (atual.length + 1 + p.length <= max) atual += ` ${p}`;
      else {
        saida.push(atual);
        atual = p;
      }
    }
    saida.push(atual);
  }
  return saida;
}

/** Cabeçalho destacado e congelado, linhas de dados, TOTAL opcional (fora do autofiltro) e nota. */
export function abaDeTabela(o: OpcoesTabela): Sheet {
  const rows: Cell[][] = [o.colunas.map((c) => cabecalhoDe(c.tipo, c.titulo))];
  for (const l of o.linhas) rows.push(o.colunas.map((c, i) => celulaDe(c.tipo, l[i])));
  if (o.total) {
    rows.push([]);
    rows.push(o.colunas.map((c, i) => celulaDeTotal(c.tipo, o.total![i], i === 0)));
  }
  if (o.nota) {
    rows.push([]);
    for (const l of quebrarEmLinhas(textoSeguro(o.nota))) rows.push(l ? [T(l)] : []);
  }
  return {
    name: o.nome,
    rows,
    colWidths: o.colunas.map((c) => c.largura),
    congelarLinhas: 1,
    ...(o.autoFiltro === false ? {} : { autoFiltro: { primeiraLinha: 1, ultimaLinha: 1 + o.linhas.length, ultimaColuna: o.colunas.length - 1 } }),
  };
}

/** Faixa de uma aba a conferir depois de escrita (ver `conferencia.ts`). */
export interface EsperadoNaAba {
  nomeAba: string;
  titulos: string[];
  nLinhas: number;
  /** Índice da coluna de valor que soma; -1 se a aba não tem total. */
  indiceValor: number;
  total: string | null;
}
