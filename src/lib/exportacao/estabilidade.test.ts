import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const aggregate = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { revenueCategorizedLine: { aggregate: (...a: unknown[]) => aggregate(...a) } } }));

import { comReceitaEstavel, impressoesIguais, lerImpressaoDaReceita } from "./estabilidade";
import { ExportacaoInconsistenteError } from "./tipos";

const resp = (linhas: number, soma: string | null, ms: number | null) => ({ _count: { _all: linhas }, _sum: { valorRecebidoCat: soma }, _max: { atualizadoEm: ms === null ? null : new Date(ms) } });

describe("leitura estável da receita (impressão digital antes e depois)", () => {
  beforeEach(() => aggregate.mockReset());

  it("lê contagem, soma e a última atualização", async () => {
    aggregate.mockResolvedValueOnce(resp(3525, "1094869.92", 1_000));
    expect(await lerImpressaoDaReceita()).toEqual({ linhas: 3525, soma: "1094869.92", atualizadaEm: 1_000 });
    aggregate.mockResolvedValueOnce(resp(0, null, null));
    expect(await lerImpressaoDaReceita()).toEqual({ linhas: 0, soma: "0", atualizadaEm: null });
  });

  it("impressoesIguais compara os três campos", () => {
    const a = { linhas: 1, soma: "1.00", atualizadaEm: 5 };
    expect(impressoesIguais(a, { ...a })).toBe(true);
    expect(impressoesIguais(a, { ...a, linhas: 2 })).toBe(false);
    expect(impressoesIguais(a, { ...a, soma: "1.01" })).toBe(false);
    expect(impressoesIguais(a, { ...a, atualizadaEm: 6 })).toBe(false);
  });

  it("receita parada: lê UMA vez", async () => {
    aggregate.mockResolvedValue(resp(10, "5.00", 100));
    const ler = vi.fn().mockResolvedValue("dados");
    expect(await comReceitaEstavel(ler)).toBe("dados");
    expect(ler).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it("a receita mudou no meio da leitura: REFAZ e entrega só a leitura estável", async () => {
    aggregate
      .mockResolvedValueOnce(resp(10, "5.00", 100)) // antes (tentativa 1)
      .mockResolvedValueOnce(resp(10, "5.00", 200)) // depois: uma linha foi regravada → refaz
      .mockResolvedValue(resp(10, "5.00", 200)); // tentativa 2: parada
    const ler = vi.fn().mockResolvedValueOnce("misturado").mockResolvedValueOnce("estável");
    expect(await comReceitaEstavel(ler)).toBe("estável");
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("não estabiliza em 3 tentativas: erro explícito (o arquivo NÃO é entregue)", async () => {
    let n = 0;
    aggregate.mockImplementation(async () => resp(10, "5.00", ++n)); // cada leitura de impressão difere da anterior
    const ler = vi.fn().mockResolvedValue("x");
    await expect(comReceitaEstavel(ler)).rejects.toBeInstanceOf(ExportacaoInconsistenteError);
    expect(ler).toHaveBeenCalledTimes(3);
    await expect(comReceitaEstavel(ler, 1)).rejects.toThrow(/mudou 1 vezes seguidas/);
  });
});
