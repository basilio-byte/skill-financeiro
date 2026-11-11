import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import {
  avaliarQuedaLiquida,
  LIMITE_QUEDA_PERCENTUAL,
  LIMITE_QUEDA_VALOR,
  mensagemRemocaoEmMassa,
  type LinhaDaRodadaComValor,
  type LinhaGravadaComValor,
} from "./remocao-em-massa";

const OUT = new Date(Date.UTC(2026, 9, 15)); // mês de crédito 2026-10

const gravada = (crConexaId: number, valor: string, extra: Partial<LinhaGravadaComValor> = {}): LinhaGravadaComValor => ({
  id: `l${crConexaId}${extra.chaveLinha ?? "A"}`,
  crConexaId,
  chaveLinha: "A",
  mesCredito: "2026-10",
  revisadoManualmente: false,
  valorRecebidoCat: money(valor),
  ...extra,
});
const daRodada = (crId: number, valor: string, chaveLinha = "A", dataCredito: Date | null = OUT): LinhaDaRodadaComValor => ({
  crId,
  chaveLinha,
  dataCredito,
  valorRecebidoCategoria: money(valor),
});
const faixa = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("avaliarQuedaLiquida", () => {
  it("RECRIA O INCIDENTE: 954 cobranças gravadas, a rodada vê 20 e apaga o resto → BLOQUEIA", () => {
    const existentes = faixa(954).map((i) => gravada(i, "343.38"));
    const linhas = faixa(20).map((i) => daRodada(i, "343.38"));
    const idsParaApagar = existentes.slice(20).map((e) => e.id);
    const a = avaliarQuedaLiquida(existentes, idsParaApagar, linhas);
    expect(a.antes.toFixed(2)).toBe("327584.52");
    expect(a.depois.toFixed(2)).toBe("6867.60");
    expect(a.queda.toFixed(2)).toBe("320716.92");
    expect(a.percentual).toBe(97.9);
    expect(a.linhasRemovidas).toBe(934);
    expect(a.bloquear).toBe(true);
    const msg = mensagemRemocaoEmMassa(a);
    expect(msg).toMatch(/R\$\s327\.584,52 para R\$\s6\.867,60/);
    expect(msg).toMatch(/97,9%/);
    expect(msg).toMatch(/removendo 934 linha\(s\)/);
    expect(msg).toMatch(/Nada foi gravado/);
  });

  it("RECATEGORIZAÇÃO legítima: todos os buckets trocam de chave com o MESMO dinheiro → não bloqueia", () => {
    const existentes = faixa(100).map((i) => gravada(i, "500.00", { chaveLinha: "Antiga" }));
    const linhas = faixa(100).map((i) => daRodada(i, "500.00", "Nova"));
    const a = avaliarQuedaLiquida(existentes, existentes.map((e) => e.id), linhas);
    expect(a.linhasRemovidas).toBe(100);
    expect(a.queda.toFixed(2)).toBe("0.00");
    expect(a.bloquear).toBe(false);
  });

  it("a receita CRESCE (o reparo de outubro: 20 gravadas, 954 na rodada) → não bloqueia", () => {
    const existentes = faixa(20).map((i) => gravada(i, "343.38"));
    const linhas = faixa(954).map((i) => daRodada(i, "343.38"));
    const a = avaliarQuedaLiquida(existentes, [], linhas);
    expect(a.queda.isNegative()).toBe(true);
    expect(a.bloquear).toBe(false);
  });

  it("valores ZERADOS sem apagar linha nenhuma (formato do export mudou) → bloqueia mesmo assim", () => {
    const existentes = faixa(100).map((i) => gravada(i, "500.00"));
    const linhas = faixa(100).map((i) => daRodada(i, "0.00"));
    const a = avaliarQuedaLiquida(existentes, [], linhas);
    expect(a.linhasRemovidas).toBe(0);
    expect(a.percentual).toBe(100);
    expect(a.bloquear).toBe(true);
  });

  it("linha REVISADA manualmente tem o valor congelado: a rodada não a derruba (e não conta queda)", () => {
    const existentes = [gravada(1, "10000.00", { revisadoManualmente: true }), gravada(2, "100.00")];
    const linhas = [daRodada(1, "0.00"), daRodada(2, "100.00")];
    const a = avaliarQuedaLiquida(existentes, [], linhas);
    expect(a.depois.toFixed(2)).toBe("10100.00");
    expect(a.queda.toFixed(2)).toBe("0.00");
    expect(a.bloquear).toBe(false);
  });

  it("linha de OUTRO mês da mesma fatura, preservada pela limpeza, continua contando", () => {
    const existentes = [gravada(1, "5000.00", { mesCredito: "2026-09", id: "set" }), gravada(1, "5000.00")];
    const linhas = [daRodada(1, "5000.00")];
    const a = avaliarQuedaLiquida(existentes, [], linhas);
    expect(a.antes.toFixed(2)).toBe("10000.00");
    expect(a.depois.toFixed(2)).toBe("10000.00");
  });

  it("primeira rodada (nada gravado) → 0%, não bloqueia", () => {
    const a = avaliarQuedaLiquida([], [], [daRodada(1, "10.00")]);
    expect(a.percentual).toBe(0);
    expect(a.bloquear).toBe(false);
  });

  describe("limites (30% E R$ 2.000,00, ambos inclusive)", () => {
    it("constantes", () => {
      expect(LIMITE_QUEDA_PERCENTUAL).toBe(30);
      expect(LIMITE_QUEDA_VALOR.toFixed(2)).toBe("2000.00");
    });

    const comQueda = (antes: string, depois: string) =>
      avaliarQuedaLiquida([gravada(1, antes)], [], [daRodada(1, depois)]);

    it("exatamente R$ 2.000,00 e exatamente 30% → bloqueia", () => {
      const a = comQueda("6666.67", "4666.67");
      expect(a.queda.toFixed(2)).toBe("2000.00");
      expect(a.percentual).toBe(30);
      expect(a.bloquear).toBe(true);
    });

    it("R$ 1.999,99 (mesmo com 99%) → não bloqueia: valor pequeno demais para travar a sincronização", () => {
      const a = comQueda("2020.20", "20.21");
      expect(a.queda.toFixed(2)).toBe("1999.99");
      expect(a.bloquear).toBe(false);
    });

    it("29,9% (mesmo com R$ 50 mil) → não bloqueia", () => {
      const a = comQueda("167224.08", "117224.08");
      expect(a.percentual).toBe(29.9);
      expect(a.bloquear).toBe(false);
    });

    it("limites são parâmetros (para testar outros cenários sem mexer nas constantes)", () => {
      const a = avaliarQuedaLiquida([gravada(1, "100.00")], [], [daRodada(1, "50.00")], { percentual: 10, valor: money("10") });
      expect(a.bloquear).toBe(true);
    });
  });
});
