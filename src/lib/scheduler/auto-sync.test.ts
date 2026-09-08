import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAutoSyncWindow, computeCarenciaWindow } from "@/lib/scheduler/auto-sync-window";
import { mesesNoIntervalo } from "@/lib/categorization/mes-credito";
import { decidirOrfas } from "@/lib/categorization/orfas";

describe("computeAutoSyncWindow (janela da sincronização automática — ADR-0013, mês corrente)", () => {
  it("periodoInicio é o dia 1 do mês corrente; periodoFim é a referência exata (não o mês inteiro)", () => {
    // 21/07/2026 12:00 UTC ~ 09:00 America/Fortaleza (UTC-3), mesmo dia-calendário.
    const referencia = new Date(Date.UTC(2026, 6, 21, 12, 0, 0));
    const { periodoInicio, periodoFim } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(periodoFim).toBe(referencia);
  });

  it("no primeiro dia do mês, periodoInicio já é hoje (não o mês anterior)", () => {
    const referencia = new Date(Date.UTC(2026, 7, 1, 14, 0, 0)); // 01/08/2026 11:00 local
    const { periodoInicio } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("dezembro corretamente permanece no mesmo ano (sem cruzar virada de ano)", () => {
    const referencia = new Date(Date.UTC(2026, 11, 15, 12, 0, 0));
    const { periodoInicio } = computeAutoSyncWindow(referencia);
    expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  describe("caminho de produção (sem referência explícita — regressão de fuso duplo, achada por verificação adversarial)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("logo após a virada do mês (fuso America/Fortaleza, UTC-3), NÃO regride para o mês anterior", () => {
      // 2026-08-01T04:00:00Z = 2026-08-01 01:00 America/Fortaleza — já é dia 1 no fuso do
      // app. Um fuso aplicado DUAS vezes (bug real: computeAutoSyncWindow passando o
      // resultado já-fusado de nowInAppTz() de volta para getPeriodBounds, que fusa de
      // novo) subtraía mais 3h e caía em 2026-07-31 22:00 — regredindo para julho.
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 1, 4, 0, 0)));
      const { periodoInicio } = computeAutoSyncWindow();
      expect(periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
    });
  });
});

describe("computeCarenciaWindow (mês anterior nos primeiros dias do mês — ADR-0030)", () => {
  const emAgostoDia = (dia: number, horaUtc = 12) => new Date(Date.UTC(2026, 8, dia, horaUtc, 0, 0));

  it("dentro da carência devolve o mês anterior INTEIRO (dia 1 ao último dia, inclusive)", () => {
    // 05/09/2026 -> agosto inteiro.
    const janela = computeCarenciaWindow(emAgostoDia(5));
    expect(janela).not.toBeNull();
    expect(janela!.periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(janela!.periodoFim.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("depois da carência devolve null (mês anterior deixa de ser reprocessado)", () => {
    expect(computeCarenciaWindow(emAgostoDia(11))).toBeNull();
    expect(computeCarenciaWindow(emAgostoDia(28))).toBeNull();
  });

  it("no último dia da carência ainda devolve janela (limite é inclusivo)", () => {
    expect(computeCarenciaWindow(emAgostoDia(10))).not.toBeNull();
  });

  it("diasDeCarencia = 0 desliga a carência (interruptor por variável de ambiente)", () => {
    expect(computeCarenciaWindow(emAgostoDia(1), 0)).toBeNull();
  });

  /**
   * A REGRESSÃO QUE ESTA ADR EXISTE PARA NÃO CAUSAR (bug crítico nº 1 da
   * ADR-0029, ver orfas.ts): a janela da carência precisa reivindicar UM mês só.
   * Se cruzasse para o mês corrente, `decidirOrfas` ganharia autoridade sobre um
   * mês que a rodada não representa — e, pior, `parseDataCreditoNoPeriodo` só
   * emite UMA parcela por fatura, então as recorrentes teriam a parcela do mês
   * corrente deixada de fora e o mês corrente pararia de ser atualizado.
   */
  it("a janela cobre EXATAMENTE um mês — nunca cruza para o mês corrente", () => {
    const janela = computeCarenciaWindow(emAgostoDia(5))!;
    expect(mesesNoIntervalo(janela.periodoInicio, janela.periodoFim)).toEqual(["2026-08"]);
  });

  it("periodoFim NÃO é o dia 1 do mês corrente (seria exclusivo, e reivindicaria dois meses)", () => {
    const janela = computeCarenciaWindow(emAgostoDia(5))!;
    expect(janela.periodoFim.toISOString().slice(0, 10)).not.toBe("2026-09-01");
  });

  it("respeita meses de 30 dias e fevereiro (nunca assume 31)", () => {
    // 03/07/2026 -> junho tem 30 dias.
    const junho = computeCarenciaWindow(new Date(Date.UTC(2026, 6, 3, 12, 0, 0)))!;
    expect(junho.periodoFim.toISOString().slice(0, 10)).toBe("2026-06-30");
    // 03/03/2026 -> fevereiro de 2026 tem 28 dias (não bissexto).
    const fevereiro = computeCarenciaWindow(new Date(Date.UTC(2026, 2, 3, 12, 0, 0)))!;
    expect(fevereiro.periodoFim.toISOString().slice(0, 10)).toBe("2026-02-28");
    // 03/03/2024 -> fevereiro de 2024 tem 29 dias (bissexto).
    const bissexto = computeCarenciaWindow(new Date(Date.UTC(2024, 2, 3, 12, 0, 0)))!;
    expect(bissexto.periodoFim.toISOString().slice(0, 10)).toBe("2024-02-29");
  });

  it("na virada de ano volta para dezembro do ano anterior", () => {
    const janela = computeCarenciaWindow(new Date(Date.UTC(2027, 0, 4, 12, 0, 0)))!;
    expect(janela.periodoInicio.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(janela.periodoFim.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  describe("fronteira de dia no fuso do app (UTC-3), não em UTC", () => {
    it("dia 10 às 23:30 LOCAL ainda está na carência, mesmo já sendo dia 11 em UTC", () => {
      // 2026-09-11T02:30:00Z = 10/09 23:30 em America/Fortaleza. Ler getDate() do
      // Date cru (UTC) daria 11 e cortaria a carência ~3h cedo, todo mês.
      const janela = computeCarenciaWindow(new Date(Date.UTC(2026, 8, 11, 2, 30, 0)));
      expect(janela).not.toBeNull();
      expect(janela!.periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
    });

    it("dia 11 às 00:30 LOCAL já saiu da carência", () => {
      // 2026-09-11T03:30:00Z = 11/09 00:30 local.
      expect(computeCarenciaWindow(new Date(Date.UTC(2026, 8, 11, 3, 30, 0)))).toBeNull();
    });
  });

  describe("caminho de produção (sem referência explícita — mesma armadilha de fuso duplo)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("logo após a virada do mês devolve o mês que acabou de fechar", () => {
      // 2026-09-01T04:00:00Z = 01/09 01:00 local — primeiro dia do mês novo.
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 4, 0, 0)));
      const janela = computeCarenciaWindow();
      expect(janela).not.toBeNull();
      expect(janela!.periodoInicio.toISOString().slice(0, 10)).toBe("2026-08-01");
      expect(janela!.periodoFim.toISOString().slice(0, 10)).toBe("2026-08-31");
    });

    it("no meio do mês não há carência nenhuma", () => {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 20, 12, 0, 0)));
      expect(computeCarenciaWindow()).toBeNull();
    });
  });

  /**
   * O caso real que originou esta ADR (medido em produção em 2026-09-08):
   * a fatura 29692 teve baixa lançada em 02/09, retroativa a 24/08, e nunca
   * entrou porque agosto congelou em 31/08 23:56. Com a carência, todo tick dos
   * primeiros 10 dias de setembro cobre 24/08.
   */
  it("a janela de setembro cobre a data de crédito da fatura que ficou de fora (24/08)", () => {
    const janela = computeCarenciaWindow(new Date(Date.UTC(2026, 8, 2, 15, 0, 0)))!;
    const dataCredito = new Date(Date.UTC(2026, 7, 24));
    expect(dataCredito.getTime()).toBeGreaterThanOrEqual(janela.periodoInicio.getTime());
    expect(dataCredito.getTime()).toBeLessThanOrEqual(janela.periodoFim.getTime());
  });
});

/**
 * A garantia mais importante da ADR-0030, e a que justifica ter feito DUAS
 * rodadas separadas em vez de uma janela ampla: reprocessar o mês anterior não
 * pode tocar no mês corrente. Estes testes exercitam `decidirOrfas` com a janela
 * REAL produzida por `computeCarenciaWindow`, não com uma janela inventada — se
 * alguém "simplificar" a janela para `toDateExclusive` (dia 1 do mês corrente),
 * `mesesDaRodada` passa a listar dois meses e estes testes quebram.
 */
describe("a rodada de carência não destrói o mês corrente (ADR-0030 × ADR-0029)", () => {
  const CHAVE = "Serviços de Espaço";
  const CR = 27166;
  const janelaCarencia = computeCarenciaWindow(new Date(Date.UTC(2026, 8, 5, 12, 0, 0)))!;
  const mesesDaRodada = mesesNoIntervalo(janelaCarencia.periodoInicio, janelaCarencia.periodoFim);

  const linha = (mesCredito: string, revisadoManualmente = false) => ({
    id: `L-${mesCredito}`,
    crConexaId: CR,
    chaveLinha: CHAVE,
    mesCredito,
    revisadoManualmente,
  });

  it("a janela da carência reivindica UM único mês", () => {
    expect(mesesDaRodada).toEqual(["2026-08"]);
  });

  it("recorrente: a rodada de agosto emite a parcela de agosto e PRESERVA a de setembro", () => {
    // A rodada de carência emite UMA parcela por fatura — a de agosto. A linha de
    // setembro da MESMA fatura não é produzida por ela; se `decidirOrfas` a
    // condenasse, a carência apagaria a receita do mês corrente toda hora.
    const decisao = decidirOrfas(
      [linha("2026-08"), linha("2026-09")],
      new Set([`${CR}::${CHAVE}::2026-08`]),
      new Map([[CR, new Set(["2026-08", "2026-09"])]]), // verdade do Conexa: credita nos dois
      mesesDaRodada,
      new Map([[CR, new Set(["2026-08"])]]), // a rodada só cobriu agosto
    );
    expect(decisao.idsParaApagar).toEqual([]);
    expect(decisao.preservadasPorRevisao).toEqual([]);
  });

  it("a linha de agosto que sumiu do Conexa É apagada — é o que corrige a 29619 (R$ 59,90)", () => {
    // Mês que a rodada COBRIU e cuja linha ela não produziu: órfã clássica. Sem a
    // carência, nenhuma rodada cobria agosto e esta linha viveria para sempre.
    const decisao = decidirOrfas(
      [linha("2026-08")],
      new Set([`${CR}::outra-categoria::2026-08`]),
      new Map([[CR, new Set(["2026-08"])]]),
      mesesDaRodada,
      new Map([[CR, new Set(["2026-08"])]]),
    );
    expect(decisao.idsParaApagar).toEqual(["L-2026-08"]);
  });

  it("linha de setembro de fatura AUSENTE da rodada de agosto sobrevive (fora da janela, silêncio)", () => {
    // Fatura que nem apareceu no export de agosto: não temos a verdade do Conexa
    // sobre ela aqui. O mês corrente é assunto da OUTRA rodada — esta não pode
    // opinar. Com uma janela ampla, `mesesDaRodada` incluiria 2026-09 e esta
    // linha seria condenada.
    const decisao = decidirOrfas(
      [linha("2026-09")],
      new Set(),
      new Map(),
      mesesDaRodada,
      new Map(),
    );
    expect(decisao.idsParaApagar).toEqual([]);
  });

  it("mesmo condenada, linha revisada manualmente é preservada e reportada (financial-rigor #9)", () => {
    const decisao = decidirOrfas(
      [linha("2026-08", true)],
      new Set([`${CR}::outra-categoria::2026-08`]),
      new Map([[CR, new Set(["2026-08"])]]),
      mesesDaRodada,
      new Map([[CR, new Set(["2026-08"])]]),
    );
    expect(decisao.idsParaApagar).toEqual([]);
    expect(decisao.preservadasPorRevisao).toEqual([`${CR}::2026-08`]);
  });
});
