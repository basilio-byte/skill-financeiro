import { formatBRL, type Money } from "@/lib/money";
import { ImportacaoInvalidaError } from "@/lib/categorization/validar-exports";

/**
 * Regras PURAS da importação manual (ADR-0034): validação do período e a política de
 * alertas da prévia. Separadas de `importacao.ts` (que lê o banco) para serem testáveis
 * sem Prisma — é aqui que mora "quando a importação não pode seguir calada".
 */

/** Queda de um mês (em %) a partir da qual a prévia exige confirmação explícita. */
export const QUEDA_QUE_EXIGE_CONFIRMACAO_PCT = 5;

/** No máximo um ano e pouco: um intervalo maior é quase certamente um erro de digitação. */
const JANELA_MAXIMA_DIAS = 400;

export interface Alerta {
  /** `bloqueio` impede a importação; `atencao` só informa (e, se crítico, exige confirmação). */
  nivel: "bloqueio" | "atencao";
  texto: string;
}

/** "2026-09" → "setembro de 2026" (para texto corrido). Pura. */
export function mesPorExtenso(aaaaMm: string): string {
  const [a, m] = aaaaMm.split("-").map(Number);
  if (!a || !m) return aaaaMm;
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Valida o período pedido. Pura. */
export function validarPeriodo(inicio: Date, fim: Date): void {
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw new ImportacaoInvalidaError("Datas inválidas.");
  }
  if (inicio.getTime() > fim.getTime()) {
    throw new ImportacaoInvalidaError("A data início não pode ser depois da data fim.");
  }
  const dias = (fim.getTime() - inicio.getTime()) / 86_400_000;
  if (dias > JANELA_MAXIMA_DIAS) {
    throw new ImportacaoInvalidaError(
      `O período tem mais de ${JANELA_MAXIMA_DIAS} dias — provavelmente um erro de data. Importe um mês (ou poucos) por vez.`,
    );
  }
}

/** Queda percentual de `antes` para `depois`; `null` se não havia nada antes. Pura. */
export function quedaPercentual(antes: Money, depois: Money): number | null {
  if (antes.lessThanOrEqualTo(0)) return null;
  const queda = antes.minus(depois).dividedBy(antes).times(100);
  return Number(queda.toFixed(2));
}

/**
 * Alertas da prévia a partir dos números já calculados. Pura — é aqui que mora a
 * política de "quando a importação não pode seguir calada".
 */
export function montarAlertas(p: {
  inicio: Date;
  fim: Date;
  hoje: Date;
  faturasAceitas: number;
  conferencia: Money;
  removidas: number;
  removidasValor: Money;
  preservadasPorRevisao: number;
  semCategoria: { linhas: number; total: Money };
  meses: Array<{ mes: string; antes: Money; depois: Money; quedaPct: number | null }>;
}): Alerta[] {
  const alertas: Alerta[] = [];

  if (p.faturasAceitas === 0) {
    alertas.push({
      nivel: "bloqueio",
      texto:
        "Nenhuma fatura do arquivo tem Data de Crédito dentro do período (com status Quitada/Negociação). " +
        "Confira se o período informado é o mesmo do filtro usado no Conexa.",
    });
  }
  if (!p.conferencia.isZero()) {
    alertas.push({
      nivel: "bloqueio",
      texto: `A conferência da skill não fechou (diferença de ${formatBRL(p.conferencia)}): a soma do Valor Recebido do arquivo não bate com a soma categorizada. Não importe — avise quem mantém o sistema.`,
    });
  }
  if (p.removidas > 0) {
    alertas.push({
      nivel: "atencao",
      texto:
        `${p.removidas} linha(s) que já estão no painel (${formatBRL(p.removidasValor)} no total) NÃO aparecem neste arquivo e seriam REMOVIDAS. ` +
        "Se o arquivo deveria cobrir o período inteiro, isto indica um export incompleto.",
    });
  }
  for (const m of p.meses) {
    if (m.quedaPct !== null && m.quedaPct > QUEDA_QUE_EXIGE_CONFIRMACAO_PCT) {
      alertas.push({
        nivel: "atencao",
        texto: `O total de ${mesPorExtenso(m.mes)} cai ${m.quedaPct.toLocaleString("pt-BR")}% com esta importação. Confira se o arquivo cobre o mês inteiro.`,
      });
    }
  }
  if (p.preservadasPorRevisao > 0) {
    alertas.push({
      nivel: "atencao",
      texto: `${p.preservadasPorRevisao} linha(s) revisada(s) manualmente não aparecem no arquivo e serão PRESERVADAS (revisão manual nunca é apagada).`,
    });
  }
  if (p.semCategoria.linhas > 0) {
    alertas.push({
      nivel: "atencao",
      texto: `${p.semCategoria.linhas} linha(s) (${formatBRL(p.semCategoria.total)}) ficariam em "Sem Categoria" — falta regra em Categorias.`,
    });
  }
  if (p.fim.getTime() > p.hoje.getTime()) {
    alertas.push({
      nivel: "atencao",
      texto: "O fim do período é depois de hoje. Datas de crédito futuras não são aceitas como receita; só vale o que já caiu.",
    });
  }
  // Período que termina HOJE (ou depois) é legítimo: o mês está em andamento. Só acusa o fim
  // quebrado quando ele já passou e não foi o último dia do mês.
  const hojeDia = Date.UTC(p.hoje.getUTCFullYear(), p.hoje.getUTCMonth(), p.hoje.getUTCDate());
  const fimJaPassou = p.fim.getTime() < hojeDia;
  const ultimoDiaDoMes = new Date(Date.UTC(p.fim.getUTCFullYear(), p.fim.getUTCMonth() + 1, 0)).getUTCDate();
  const meiaJanela = p.inicio.getUTCDate() !== 1 || (fimJaPassou && ultimoDiaDoMes !== p.fim.getUTCDate());
  if (meiaJanela) {
    alertas.push({
      nivel: "atencao",
      texto: "O período não começa no dia 1º ou não termina no último dia do mês. Só o que está dentro dele é atualizado; para fechar um mês, importe o mês inteiro.",
    });
  }
  return alertas;
}

