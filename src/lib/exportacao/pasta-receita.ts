import { formatBRL, money, toAmountString, ZERO, type Money } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { COLUNA_VALOR_RECEITA, colunasDosGrupos, type LinhaReceita } from "./colunas-receita";
import { descreverFiltros, periodoEfetivo, dataBr, ROTULO_PROPORCIONADO, type FiltrosReceita, type ProporcionadoFiltro } from "./filtros-receita";
import {
  abaDeDetalhe,
  abaDeResumo,
  abaLeiaMe,
  abaMatriz,
  agrupar,
  somaDoResumo,
  totalGeral,
  type Detalhe,
  type GrupoResumo,
} from "./planilha";
import { ExportacaoInconsistenteError, type UsuarioExport } from "./tipos";

/**
 * A pasta de trabalho da exportação de RECEITA (ADR-0035) — montagem PURA (sem banco), testável com fixtures.
 *
 * Abas: Leia-me · Cobranças (detalhe) · Por categoria · Por conta · Por unidade · Por situação · Rateio ·
 * [Por mês · Categoria x mês, quando o recorte cobre mais de um mês] · Por dia.
 *
 * Todos os resumos saem do MESMO conjunto de linhas do detalhe e são conferidos contra ele: se algum não fechar, a
 * montagem lança `ExportacaoInconsistenteError` e o arquivo não é entregue.
 */

export interface EntradaPasta {
  linhas: LinhaReceita[];
  filtros: FiltrosReceita;
  geradoEm: Date;
  usuario: UsuarioExport;
  /** Frase pronta sobre a atualidade da sincronização. */
  frescor: { texto: string; alerta: boolean };
  /** Quantas linhas do banco inteiro não têm Data de Crédito (nenhum recorte por período as inclui). */
  semDataCreditoNoBanco: number;
  /** "aaaa-mm-dd" de hoje no fuso do app. */
  hoje: string;
  /**
   * Abas extras (ex.: Itens), já montadas por quem chama; entram no fim. `soma` (quando informada) é conferida contra o
   * total do detalhe; `aviso` entra na lista de avisos do Leia-me.
   */
  extras?: Array<{ aba: Sheet; soma?: Money; aviso?: string }>;
}

export interface SaidaPasta {
  abas: Sheet[];
  detalhe: Detalhe;
  total: Money;
  faturas: number;
  /** Menor e maior Data de Crédito presentes nos dados ("aaaa-mm-dd"), ou null. */
  intervalo: { de: string; ate: string } | null;
  /** Colunas do detalhe, na ordem do arquivo (para conferência de leitura de volta). */
  titulosDasColunas: string[];
}

const valorCat = (l: LinhaReceita) => l.valorRecebidoCat;
const fatura = (l: LinhaReceita) => l.crConexaId;
const isoDia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "(sem data)");

export const AVISO_VALORES_DA_FATURA =
  "Some SOMENTE a coluna 'Valor Recebido Cat.' (valor da linha, já rateado por categoria). 'Valor Recebido Total', 'Valor Bruto' e " +
  "'Valor Desconto' são da fatura inteira e se repetem em cada linha dela: somá-los conta o mesmo dinheiro mais de uma vez.";

export function montarAbasReceita(e: EntradaPasta): SaidaPasta {
  const { linhas, filtros } = e;
  const colunas = colunasDosGrupos(filtros.grupos);
  const detalhe = abaDeDetalhe({ nome: "Cobranças", colunas, linhas, colunaTotal: COLUNA_VALOR_RECEITA });
  const total = totalGeral(linhas, valorCat, fatura);
  const somaDetalhe = toAmountString(total.valor);

  // --- resumos -------------------------------------------------------------------------------------------------
  const resumos: Array<{ aba: Sheet; soma: Money }> = [];
  const resumo = (nome: string, tituloChave: string, grupos: GrupoResumo[], chaveEhData = false) => {
    resumos.push({ aba: abaDeResumo({ nome, tituloChave, grupos, total, chaveEhData }), soma: somaDoResumo(grupos) });
  };

  const meses = [...new Set(linhas.map((l) => l.mesCredito))].sort();

  if (filtros.resumos) {
    resumo("Por categoria", "Categoria", agrupar(linhas, (l) => l.categoria, valorCat, fatura));
    resumo("Por conta", "Conta", agrupar(linhas, (l) => l.conta || "(sem conta informada)", valorCat, fatura));
    resumo("Por unidade", "Unidade", agrupar(linhas, (l) => l.unidade || "(sem unidade)", valorCat, fatura));
    resumo("Por situação", "Situação da cobrança", agrupar(linhas, (l) => l.status || "(sem situação)", valorCat, fatura));
    resumo(
      "Rateio",
      "Confiabilidade da categorização",
      agrupar(linhas, (l) => ROTULO_PROPORCIONADO[l.proporcionado as ProporcionadoFiltro] ?? l.proporcionado, valorCat, fatura),
    );
    if (meses.length > 1) resumo("Por mês", "Mês de crédito", agrupar(linhas, (l) => l.mesCredito, valorCat, fatura, "chave"));
    resumo("Por dia", "Data de crédito", agrupar(linhas, (l) => isoDia(l.dataCredito), valorCat, fatura, "chave"), true);
  }

  let matriz: ReturnType<typeof abaMatriz> | null = null;
  if (filtros.resumos && meses.length > 1) {
    matriz = abaMatriz({ nome: "Categoria x mês", tituloLinha: "Categoria", linhas, linhaDe: (l) => l.categoria, colunaDe: (l) => l.mesCredito, valorDe: valorCat });
  }

  // --- conferência: cada resumo fecha com o detalhe ---------------------------------------------------------------
  const divergencias: string[] = [];
  resumos.forEach((r) => {
    if (!r.soma.equals(total.valor)) divergencias.push(`${r.aba.name}: ${toAmountString(r.soma)} ≠ ${somaDetalhe}`);
  });
  if (matriz && !matriz.total.equals(total.valor)) divergencias.push(`Categoria x mês: ${toAmountString(matriz.total)} ≠ ${somaDetalhe}`);
  if (detalhe.total !== null && detalhe.total !== somaDetalhe) divergencias.push(`Cobranças (rodapé): ${detalhe.total} ≠ ${somaDetalhe}`);
  for (const x of e.extras ?? []) {
    if (x.soma && !x.soma.equals(total.valor)) divergencias.push(`${x.aba.name}: ${toAmountString(x.soma)} ≠ ${somaDetalhe}`);
  }
  if (divergencias.length) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${divergencias.join("; ")}.`);
  }

  // --- aba Leia-me ---------------------------------------------------------------------------------------------------
  const datas = linhas.map((l) => l.dataCredito).filter((d): d is Date => d !== null).map((d) => d.toISOString().slice(0, 10)).sort();
  const intervalo = datas.length ? { de: datas[0]!, ate: datas[datas.length - 1]! } : null;

  const revisadas = linhas.filter((l) => l.revisadoManualmente).length;
  const semCategoria = linhas.filter((l) => l.categoria === "Sem Categoria");
  const semCategoriaValor = semCategoria.reduce<Money>((acc, l) => acc.plus(money(l.valorRecebidoCat)), ZERO);
  const { de, ate } = periodoEfetivo(filtros);
  // O recorte alcança o dia de hoje (ou não tem limite de data): o mês corrente ainda está em andamento.
  const incluiHoje = (!de || de <= e.hoje) && (!ate || ate >= e.hoje);

  const avisos: string[] = [];
  if (filtros.grupos.includes("fatura")) avisos.push(AVISO_VALORES_DA_FATURA);
  avisos.push("Cada linha é uma categoria dentro de uma fatura, por mês de crédito: o número de linhas não é o número de faturas (uma fatura rateada ocupa mais de uma linha).");
  avisos.push("Receita por Data de Crédito da Cobrança (regime de caixa) — o mesmo critério do Panorama. Competência, vencimento e quitação aparecem só como colunas.");
  avisos.push(
    "A categoria de cada linha segue as regras vigentes na última sincronização do período. Reprocessar um mês fechado recategoriza com as regras de hoje, " +
      "então a quebra por categoria pode diferir de uma exportação anterior do mesmo mês.",
  );
  if (revisadas > 0) avisos.push(`${revisadas} linha(s) foram revisadas manualmente: categoria e valor ficam congelados (o grupo "Auditoria e revisão" mostra o valor original).`);
  if (semCategoria.length > 0) avisos.push(`${semCategoria.length} linha(s) estão em "Sem Categoria" (${formatBRL(semCategoriaValor)}): falta cadastrar a regra do serviço/plano em Categorias.`);
  if (incluiHoje) avisos.push("O período inclui dias ainda em andamento: o total muda a cada sincronização (a cada 15 minutos).");
  for (const x of e.extras ?? []) if (x.aviso) avisos.push(x.aviso);
  if (e.semDataCreditoNoBanco > 0) avisos.push(`Existem ${e.semDataCreditoNoBanco} linha(s) sem Data de Crédito no banco; nenhum recorte por data as inclui.`);

  const resultado: Array<[string, string]> = [
    ["Linhas exportadas", `${linhas.length.toLocaleString("pt-BR")} (cada linha = uma categoria dentro de uma fatura)`],
    ["Faturas distintas", total.faturas.toLocaleString("pt-BR")],
    ["Valor Recebido Cat. (total)", formatBRL(total.valor)],
  ];
  if (intervalo) resultado.push(["Datas de crédito presentes nos dados", `${dataBr(intervalo.de)} a ${dataBr(intervalo.ate)}`]);
  resultado.push(["Colunas do detalhe", colunas.map((c) => c.titulo).join(" · ")]);

  const leiaMe = abaLeiaMe({
    titulo: "Exportação de receita — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: `${e.usuario.nome} (${e.usuario.email})`,
    filtros: descreverFiltros(filtros),
    resultado,
    frescor: e.frescor,
    avisos,
    conferencia:
      `OK. A soma do detalhe (${formatBRL(total.valor)}) foi conferida contra o banco, contra cada resumo e contra o arquivo lido de volta, ` +
      "antes de entregar. Se alguma dessas conferências não fechasse, o arquivo não seria gerado.",
  });

  return {
    abas: [leiaMe, detalhe.aba, ...resumos.map((r) => r.aba), ...(matriz ? [matriz.aba] : []), ...(e.extras ?? []).map((x) => x.aba)],
    detalhe,
    total: total.valor,
    faturas: total.faturas,
    intervalo,
    titulosDasColunas: colunas.map((c) => c.titulo),
  };
}
