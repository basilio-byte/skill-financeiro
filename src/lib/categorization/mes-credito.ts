/**
 * O mês do crédito — a parte MENSAL da identidade da linha de receita (ADR-0029).
 *
 * Por que existe: uma cobrança recorrente tem uma LISTA de datas de crédito, uma
 * por parcela, e entrega o mesmo valor em cada mês da lista. Enquanto a linha era
 * chaveada só por `(crConexaId, chaveLinha)`, a rodada de agosto reescrevia a
 * `dataCredito` da linha de julho e a receita MIGRAVA de mês (provado em produção:
 * 10 faturas, R$ 1.097,07, todas no dia exato previsto pela lista de datas).
 *
 * Por que o MÊS e não a data crua: o Conexa exporta UMA parcela por cobrança
 * mesmo quando duas datas de crédito caem na janela (medido: das 7 cobranças com
 * 2 parcelas no mesmo mês, o export traz uma linha só). Com a data crua na chave,
 * uma sincronização manual de período diferente escolheria outra data da mesma
 * fatura e criaria uma SEGUNDA linha no mesmo mês — dobrando a receita dela. Com
 * o mês, qualquer rodada que toque julho produz a mesma chave e faz upsert na
 * mesma linha.
 */

/** Zero-pad de 2 casas, para "2026-7" nunca virar chave diferente de "2026-07". */
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "yyyy-MM" da data de crédito. Lê SEMPRE em UTC, nunca no fuso local.
 *
 * `dataCredito` é `@db.Date` e o Prisma devolve meia-noite UTC. Usar
 * `getMonth()`/`getFullYear()` locais num fuso negativo (o app roda em
 * America/Fortaleza, UTC−3) devolveria o dia ANTERIOR — e no dia 1º de cada mês
 * isso jogaria a linha para o mês errado, mudando a identidade dela. É o mesmo
 * bug de fuso que este projeto já corrigiu duas vezes (janela do auto-sync na
 * ADR-0013 e `periodoCorrente()` na ADR-0023) e que aqui seria pior: não
 * mostraria número errado, criaria linha duplicada.
 */
export function mesDoCredito(data: Date): string {
  return `${data.getUTCFullYear()}-${pad2(data.getUTCMonth() + 1)}`;
}

/**
 * Mês de uma linha sem data de crédito.
 *
 * Não deveria acontecer: `run.ts` descarta CR com `dataCredito === null` antes de
 * categorizar, e o snapshot de produção (2026-08-04) mostrou ZERO linhas assim.
 * Mas a coluna é nullable no schema e o tipo `CategorizedLine.dataCredito` é
 * `Date | null`, então tratamos em vez de fingir que é impossível.
 *
 * O valor é deliberadamente um mês INVÁLIDO, e é o MESMO usado no backfill da
 * migration: se aparecer numa tela ou numa conferência, é sinal alto de que uma
 * linha entrou sem data — não um valor que se confunda com mês de verdade. Código
 * e banco precisam concordar aqui, senão a mesma linha teria identidades
 * diferentes nos dois lados.
 */
export const MES_SEM_DATA = "0000-00";

/** `mesDoCredito` tolerante a null — ver `MES_SEM_DATA`. */
export function mesDoCreditoOuSentinela(data: Date | null | undefined): string {
  return data ? mesDoCredito(data) : MES_SEM_DATA;
}

/**
 * Todos os meses "yyyy-MM" tocados por um intervalo [início, fim], inclusive.
 *
 * Usado para escopar a limpeza de órfãs ao que a rodada realmente é responsável.
 * Sem isso, a rodada de agosto veria as linhas de julho da mesma fatura como
 * órfãs (elas não estão no resultado dela) e as APAGARIA — trocando "a receita
 * migra de mês" por "a receita some de vez", que é bem pior.
 *
 * Também em UTC, pelo mesmo motivo de `mesDoCredito`: os dois lados da
 * comparação precisam ser derivados da mesma régua.
 */
export function mesesNoIntervalo(inicio: Date, fim: Date): string[] {
  if (fim < inicio) return [];
  const meses: string[] = [];
  // Caminha de mês em mês pelo dia 1 em UTC — imune a mês de 28/30/31 dias e a
  // horário de verão, porque nunca soma "30 dias", sempre incrementa o mês.
  const cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));
  const ultimo = `${fim.getUTCFullYear()}-${pad2(fim.getUTCMonth() + 1)}`;
  for (;;) {
    const atual = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}`;
    meses.push(atual);
    if (atual === ultimo) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    // Trava de segurança: um intervalo absurdo (data corrompida) não pode virar
    // laço infinito dentro de uma transação Serializable.
    if (meses.length > 240) break;
  }
  return meses;
}
