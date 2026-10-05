import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { nowInAppTz } from "@/lib/dates";
import { money, roundMoney, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import { mesDoCreditoOuSentinela, mesesNoIntervalo } from "@/lib/categorization/mes-credito";
import { chaveLinhaCompleta, planejarLimpeza } from "@/lib/categorization/orfas";
import { filtroLinhasAlcancadas } from "@/lib/categorization/persist";
import { prepararRodada } from "@/lib/categorization/preparar";
import { regrasAtivasParaRodada } from "@/lib/categorization/regras-ativas";
import { startCategorizationRun } from "@/lib/categorization/run";
import { SEM_CATEGORIA } from "@/lib/categorization/rules";
import { ImportacaoInvalidaError, validarArquivos } from "@/lib/categorization/validar-exports";
import {
  montarAlertas,
  QUEDA_QUE_EXIGE_CONFIRMACAO_PCT,
  quedaPercentual,
  validarPeriodo,
  type Alerta,
} from "@/lib/categorization/importacao-regras";

/**
 * Importação MANUAL dos exports do Conexa (ADR-0034).
 *
 * Por quê: o login web do Conexa passou a exigir reCAPTCHA (ADR-0032) e a receita
 * (Data de Crédito da Cobrança) só existe nessa tela, não na API v2. Uma pessoa
 * baixa os dois exports no Conexa (ela passa pelo captcha) e os envia aqui; o resto
 * é a MESMA rodada de sempre — `startCategorizationRun` só troca de onde vêm os
 * arquivos.
 *
 * O que torna isto seguro: a persistência APAGA linhas do período que não vêm no
 * resultado (órfãs, ADR-0029). Num download automático isso é correto (o Conexa é
 * a verdade). Num arquivo enviado à mão, um export PARCIAL (filtro errado, meio mês)
 * apagaria receita real. Por isso toda importação passa por uma PRÉVIA somente
 * leitura que mostra, antes de gravar, quanto seria criado, atualizado e REMOVIDO e
 * como cada mês muda — e a importação só roda com o selo dessa prévia, e com
 * confirmação explícita quando algo seria removido ou o total de um mês cai.
 */

export { QUEDA_QUE_EXIGE_CONFIRMACAO_PCT, type Alerta };

export class ImportacaoDesatualizadaError extends Error {}

export interface ArquivoRecebido {
  nome: string;
  conteudo: Buffer;
}

export interface PreviaImportacao {
  periodo: { inicio: string; fim: string };
  arquivos: {
    contasReceber: { nome: string; bytes: number; sha256: string; linhas: number };
    listarVendas: { nome: string; bytes: number; sha256: string; linhas: number };
  };
  leitura: {
    faturasNoArquivo: number;
    faturasAceitasNoPeriodo: number;
    faturasIgnoradas: number;
    itensDeVenda: number;
    totalRecebido: string;
    faturasSemListarVendas: number;
    semCategoria: { linhas: number; total: string };
    /** Deve ser "0.00": soma do Valor Recebido do CR aceito − soma categorizada. */
    conferencia: string;
  };
  mudancas: {
    novas: number;
    atualizadas: number;
    removidas: number;
    removidasValor: string;
    preservadasPorRevisao: number;
  };
  meses: Array<{ mes: string; antes: string; depois: string; diferenca: string; quedaPct: number | null }>;
  removidasAmostra: Array<{ crConexaId: number; mes: string; categoria: string; valor: string }>;
  categorias: Array<{ categoria: string; total: string }>;
  alertas: Alerta[];
  /** Algo seria removido ou um mês cai além do limite: a importação pede confirmação. */
  exigeConfirmacao: boolean;
  /** Impressão da prévia. A importação só roda se ela ainda for a mesma. */
  selo: string;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const isoDia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * PRÉVIA somente leitura: faz tudo que a rodada real faria, exceto gravar.
 * Usa as MESMAS funções da rodada (`prepararRodada`, `planejarLimpeza`,
 * `filtroLinhasAlcancadas`, `regrasAtivasParaRodada`), então não pode divergir dela.
 */
export async function gerarPrevia(p: {
  contasReceber: ArquivoRecebido;
  listarVendas: ArquivoRecebido;
  periodoInicio: Date;
  periodoFim: Date;
}): Promise<PreviaImportacao> {
  validarPeriodo(p.periodoInicio, p.periodoFim);
  const resumoArquivos = validarArquivos(p.contasReceber.conteudo, p.listarVendas.conteudo);

  const rules = await regrasAtivasParaRodada();
  let preparada;
  try {
    preparada = prepararRodada({
      contasReceber: p.contasReceber.conteudo,
      listarVendas: p.listarVendas.conteudo,
      periodoInicio: p.periodoInicio,
      periodoFim: p.periodoFim,
      rules,
    });
  } catch (err) {
    throw new ImportacaoInvalidaError(
      `Não foi possível interpretar os arquivos (${err instanceof Error ? err.message : "erro desconhecido"}). ` +
        "Envie os originais baixados do Conexa, sem abrir no Excel.",
    );
  }
  const { resultado, crRows, crRowsAll, lvRows, diferencaConferencia } = preparada;
  const linhas = resultado.linhas;

  // Estado atual do banco que a rodada alcançaria — exatamente o que a persistência leria.
  const existentes = await prisma.revenueCategorizedLine.findMany({
    where: filtroLinhasAlcancadas(linhas, p.periodoInicio, p.periodoFim),
    select: {
      id: true,
      crConexaId: true,
      chaveLinha: true,
      mesCredito: true,
      revisadoManualmente: true,
      categoria: true,
      valorRecebidoCat: true,
    },
  });
  const plano = planejarLimpeza(existentes, linhas, p.periodoInicio, p.periodoFim);
  const apagar = new Set(plano.idsParaApagar);
  const existentePorChave = new Map(
    existentes.map((e) => [chaveLinhaCompleta(e.crConexaId, e.chaveLinha, e.mesCredito), e]),
  );

  let novas = 0;
  let atualizadas = 0;
  for (const l of linhas) {
    const chave = chaveLinhaCompleta(l.crId, l.chaveLinha, mesDoCreditoOuSentinela(l.dataCredito));
    if (existentePorChave.has(chave)) atualizadas += 1;
    else novas += 1;
  }

  // Valor de cada linha depois da importação — espelha a persistência: revisada
  // manualmente mantém categoria e valor; apagada some; o resto assume o valor novo.
  const novoValorPorChave = new Map<string, Money>();
  for (const l of linhas) {
    novoValorPorChave.set(
      chaveLinhaCompleta(l.crId, l.chaveLinha, mesDoCreditoOuSentinela(l.dataCredito)),
      l.valorRecebidoCategoria,
    );
  }

  const meses = mesesNoIntervalo(p.periodoInicio, p.periodoFim);
  const mesesSet = new Set(meses);

  const antesPorMesBanco = await prisma.revenueCategorizedLine.groupBy({
    by: ["mesCredito"],
    where: { mesCredito: { in: meses } },
    _sum: { valorRecebidoCat: true },
  });
  const antes = new Map<string, Money>(meses.map((m) => [m, ZERO]));
  for (const g of antesPorMesBanco) antes.set(g.mesCredito, money(g._sum.valorRecebidoCat?.toString() ?? "0"));

  // depois = antes − (alcançadas no mês, valor atual) + (alcançadas no mês, valor depois) + (linhas novas).
  const depois = new Map<string, Money>(antes);
  const somar = (mes: string, delta: Money) => depois.set(mes, (depois.get(mes) ?? ZERO).plus(delta));
  for (const e of existentes) {
    if (!mesesSet.has(e.mesCredito)) continue;
    const atual = money(e.valorRecebidoCat.toString());
    const chave = chaveLinhaCompleta(e.crConexaId, e.chaveLinha, e.mesCredito);
    let aposImportar: Money;
    if (apagar.has(e.id)) aposImportar = ZERO;
    else if (e.revisadoManualmente) aposImportar = atual;
    else aposImportar = novoValorPorChave.get(chave) ?? atual;
    somar(e.mesCredito, aposImportar.minus(atual));
  }
  for (const l of linhas) {
    const mes = mesDoCreditoOuSentinela(l.dataCredito);
    const chave = chaveLinhaCompleta(l.crId, l.chaveLinha, mes);
    if (!existentePorChave.has(chave) && mesesSet.has(mes)) somar(mes, l.valorRecebidoCategoria);
  }

  const mesesResumo = meses.map((mes) => {
    const a = roundMoney(antes.get(mes) ?? ZERO);
    const d = roundMoney(depois.get(mes) ?? ZERO);
    return {
      mes,
      antes: toAmountString(a),
      depois: toAmountString(d),
      diferenca: toAmountString(d.minus(a)),
      quedaPct: quedaPercentual(a, d),
      _antes: a,
      _depois: d,
    };
  });

  const removidasLinhas = existentes.filter((e) => apagar.has(e.id));
  const removidasValor = roundMoney(sum(removidasLinhas.map((e) => e.valorRecebidoCat.toString())));
  const semCategoriaLinhas = linhas.filter((l) => l.categoria === SEM_CATEGORIA);
  const semCategoria = {
    linhas: semCategoriaLinhas.length,
    total: roundMoney(sum(semCategoriaLinhas.map((l) => l.valorRecebidoCategoria))),
  };

  const alertas = montarAlertas({
    inicio: p.periodoInicio,
    fim: p.periodoFim,
    hoje: nowInAppTz(),
    faturasAceitas: crRows.length,
    conferencia: diferencaConferencia,
    removidas: removidasLinhas.length,
    removidasValor,
    preservadasPorRevisao: plano.preservadasPorRevisao.length,
    semCategoria,
    meses: mesesResumo.map((m) => ({ mes: m.mes, antes: m._antes, depois: m._depois, quedaPct: m.quedaPct })),
  });

  const exigeConfirmacao =
    removidasLinhas.length > 0 ||
    mesesResumo.some((m) => m.quedaPct !== null && m.quedaPct > QUEDA_QUE_EXIGE_CONFIRMACAO_PCT);

  const previa: Omit<PreviaImportacao, "selo"> = {
    periodo: { inicio: isoDia(p.periodoInicio), fim: isoDia(p.periodoFim) },
    arquivos: {
      contasReceber: {
        nome: p.contasReceber.nome,
        bytes: p.contasReceber.conteudo.length,
        sha256: sha256(p.contasReceber.conteudo),
        linhas: resumoArquivos.linhasContasReceber,
      },
      listarVendas: {
        nome: p.listarVendas.nome,
        bytes: p.listarVendas.conteudo.length,
        sha256: sha256(p.listarVendas.conteudo),
        linhas: resumoArquivos.linhasListarVendas,
      },
    },
    leitura: {
      faturasNoArquivo: crRowsAll.length,
      faturasAceitasNoPeriodo: crRows.length,
      faturasIgnoradas: crRowsAll.length - crRows.length,
      itensDeVenda: lvRows.length,
      totalRecebido: toAmountString(resultado.totalRecebido),
      faturasSemListarVendas: resultado.totalSemLV,
      semCategoria: { linhas: semCategoria.linhas, total: toAmountString(semCategoria.total) },
      conferencia: toAmountString(diferencaConferencia),
    },
    mudancas: {
      novas,
      atualizadas,
      removidas: removidasLinhas.length,
      removidasValor: toAmountString(removidasValor),
      preservadasPorRevisao: plano.preservadasPorRevisao.length,
    },
    meses: mesesResumo.map(({ _antes, _depois, ...resto }) => resto),
    removidasAmostra: removidasLinhas
      .map((e) => ({
        crConexaId: e.crConexaId,
        mes: e.mesCredito,
        categoria: e.categoria,
        valor: toAmountString(money(e.valorRecebidoCat.toString())),
      }))
      .sort((a, b) => Number(b.valor) - Number(a.valor))
      .slice(0, 10),
    categorias: resultado.resumoPorCategoria,
    alertas,
    exigeConfirmacao,
  };

  return { ...previa, selo: selarPrevia(previa) };
}

/**
 * Impressão digital da prévia: períodos, arquivos (por hash) e os números que decidem.
 * Se qualquer um mudar entre a prévia e a importação (o banco mudou, ou o arquivo é
 * outro), o selo não confere e a importação recusa — a pessoa vê de novo antes de gravar.
 */
export function selarPrevia(previa: Omit<PreviaImportacao, "selo">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        periodo: previa.periodo,
        cr: previa.arquivos.contasReceber.sha256,
        lv: previa.arquivos.listarVendas.sha256,
        mudancas: previa.mudancas,
        meses: previa.meses,
        total: previa.leitura.totalRecebido,
      }),
    )
    .digest("hex");
}

/**
 * Importa de verdade — só se a prévia que a pessoa viu ainda vale.
 *
 * Reexecuta a prévia (barata) e compara o selo, em vez de confiar em números enviados
 * pelo navegador. Entre a conferência e a gravação ainda existe uma janela mínima; ela
 * é coberta pela própria persistência (transação Serializable + revisão manual
 * protegida), exatamente como numa rodada automática.
 */
export async function importarExports(p: {
  contasReceber: ArquivoRecebido;
  listarVendas: ArquivoRecebido;
  periodoInicio: Date;
  periodoFim: Date;
  selo: string;
  confirmacao: boolean;
  executadoPorId: string;
}): Promise<string> {
  const previa = await gerarPrevia(p);

  if (previa.selo !== p.selo) {
    throw new ImportacaoDesatualizadaError(
      "Os dados mudaram desde a prévia (outra sincronização, uma revisão ou arquivos diferentes). Gere a prévia de novo e confira antes de importar.",
    );
  }
  const bloqueio = previa.alertas.find((a) => a.nivel === "bloqueio");
  if (bloqueio) throw new ImportacaoInvalidaError(bloqueio.texto);
  if (previa.exigeConfirmacao && !p.confirmacao) {
    throw new ImportacaoInvalidaError(
      "Esta importação remove linhas ou reduz o total de um mês: marque a confirmação depois de conferir a prévia.",
    );
  }

  return startCategorizationRun({
    periodoInicio: p.periodoInicio,
    periodoFim: p.periodoFim,
    executadoPorId: p.executadoPorId,
    origem: "IMPORTACAO",
    exportsManuais: {
      contasReceber: p.contasReceber.conteudo,
      listarVendas: p.listarVendas.conteudo,
      entrada: {
        contasReceber: previa.arquivos.contasReceber,
        listarVendas: previa.arquivos.listarVendas,
        selo: previa.selo,
        confirmouRemocaoOuQueda: previa.exigeConfirmacao,
      },
    },
  });
}
