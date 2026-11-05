import { money, sum, toAmountString, ZERO } from "@/lib/money";
import type { LinhaReceita } from "./colunas-receita";

/**
 * Conferências da exportação (ADR-0035) — PURAS: recebem números e devolvem a lista do que NÃO fechou (vazia = ok).
 * Quem chama transforma qualquer divergência em `ExportacaoInconsistenteError`: o arquivo não é entregue.
 *
 * Duas conferências independentes, de propósito:
 *  1. `conferirContraBanco` — o que o código montou em memória bate com o que o BANCO soma pelo mesmo filtro
 *     (contagem, total e total por categoria, lidos na mesma transação)? Pega leitura truncada e erro de soma.
 *  2. `conferirLeituraDeVolta` — o ARQUIVO escrito, relido, tem as mesmas linhas e a mesma soma? Pega defeito do
 *     gerador (célula deslocada, XML malformado, número virando texto).
 */

export interface ReferenciaBanco {
  contagem: number;
  /** Soma de valorRecebidoCat pelo mesmo filtro, "1234.56". */
  total: string;
  porCategoria: Map<string, string>;
}

export function conferirContraBanco(linhas: LinhaReceita[], ref: ReferenciaBanco): string[] {
  const problemas: string[] = [];
  if (linhas.length !== ref.contagem) problemas.push(`linhas lidas (${linhas.length}) ≠ contagem do banco (${ref.contagem})`);

  const somaLocal = toAmountString(sum(linhas.map((l) => l.valorRecebidoCat)));
  if (somaLocal !== ref.total) problemas.push(`soma das linhas (${somaLocal}) ≠ soma do banco (${ref.total})`);

  const local = new Map<string, ReturnType<typeof money>>();
  for (const l of linhas) local.set(l.categoria, (local.get(l.categoria) ?? ZERO).plus(money(l.valorRecebidoCat)));
  for (const k of new Set([...local.keys(), ...ref.porCategoria.keys()])) {
    const a = toAmountString(local.get(k) ?? ZERO);
    const b = toAmountString(money(ref.porCategoria.get(k) ?? "0"));
    if (a !== b) problemas.push(`categoria "${k}": linhas somam ${a}, banco soma ${b}`);
  }
  return problemas;
}

export interface EsperadoNoArquivo {
  /** Títulos do cabeçalho, na ordem. */
  titulos: string[];
  /** Linhas de dados. */
  nLinhas: number;
  /** Índice (0-based) da coluna de valor que soma; -1 se não há. */
  indiceValor: number;
  /** Soma esperada da coluna de valor. */
  total: string;
}

/** `linhas` = a aba lida de volta (linha 1 = índice 0): cabeçalho, dados, linha em branco, rodapé TOTAL. */
export function conferirLeituraDeVolta(linhas: string[][], esperado: EsperadoNoArquivo): string[] {
  const problemas: string[] = [];
  const cab = linhas[0] ?? [];
  esperado.titulos.forEach((t, i) => {
    if (cab[i] !== t) problemas.push(`cabeçalho da coluna ${i + 1}: esperado "${t}", lido "${cab[i] ?? ""}"`);
  });

  if (linhas.length < 1 + esperado.nLinhas) {
    problemas.push(`o arquivo tem ${Math.max(0, linhas.length - 1)} linha(s) de dados, esperado ${esperado.nLinhas}`);
    return problemas;
  }
  if (esperado.indiceValor < 0) return problemas;

  let soma = ZERO;
  for (let r = 1; r <= esperado.nLinhas; r++) {
    const cel = linhas[r]?.[esperado.indiceValor] ?? "";
    if (!/^-?\d+(\.\d+)?$/.test(cel)) {
      problemas.push(`linha ${r + 1}: valor "${cel}" não é número`);
      if (problemas.length > 10) break;
      continue;
    }
    soma = soma.plus(money(cel));
  }
  const lida = toAmountString(soma);
  if (lida !== esperado.total) problemas.push(`soma lida do arquivo (${lida}) ≠ esperada (${esperado.total})`);

  // rodapé: linha em branco e depois TOTAL
  const rodape = linhas[esperado.nLinhas + 2] ?? [];
  if (rodape[0] !== "TOTAL") problemas.push("o rodapé TOTAL não está onde deveria");
  else if (toAmountString(money(rodape[esperado.indiceValor] ?? "0")) !== esperado.total) {
    problemas.push(`rodapé TOTAL (${rodape[esperado.indiceValor]}) ≠ esperado (${esperado.total})`);
  }
  return problemas;
}
