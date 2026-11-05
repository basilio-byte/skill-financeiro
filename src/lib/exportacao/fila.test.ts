import { describe, expect, it } from "vitest";
import { ceder, emExclusao, MAX_NA_FILA, tamanhoDaFila } from "@/lib/exportacao/fila";
import { ExportacaoOcupadaError } from "@/lib/exportacao/tipos";

const dorme = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("fila de uma exportação por vez", () => {
  it("nunca roda duas ao mesmo tempo, e na ordem de chegada", async () => {
    let simultaneas = 0;
    let maxSimultaneas = 0;
    const ordem: number[] = [];
    const tarefa = (n: number) => () =>
      (async () => {
        simultaneas += 1;
        maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
        await dorme(15);
        ordem.push(n);
        simultaneas -= 1;
        return n;
      })();
    const resultados = await Promise.all([1, 2, 3, 4].map((n) => emExclusao(tarefa(n))));
    expect(resultados).toEqual([1, 2, 3, 4]);
    expect(maxSimultaneas).toBe(1);
    expect(ordem).toEqual([1, 2, 3, 4]);
    expect(tamanhoDaFila()).toBe(0);
  });

  it("recusa (503) quem chega com a fila cheia, sem derrubar as que já estão nela", async () => {
    const lentas = Array.from({ length: MAX_NA_FILA }, (_, i) => emExclusao(async () => (await dorme(20), i)));
    await expect(emExclusao(async () => "intruso")).rejects.toBeInstanceOf(ExportacaoOcupadaError);
    expect(await Promise.all(lentas)).toEqual([0, 1, 2, 3]);
    // passada a fila, volta a aceitar
    expect(await emExclusao(async () => "de novo")).toBe("de novo");
  });

  it("uma tarefa que FALHA libera a vez da seguinte (a fila não trava)", async () => {
    const falha = emExclusao(async () => {
      await dorme(5);
      throw new Error("boom");
    });
    const seguinte = emExclusao(async () => "ok");
    await expect(falha).rejects.toThrow("boom");
    expect(await seguinte).toBe("ok");
    expect(tamanhoDaFila()).toBe(0);
  });

  it("ceder devolve o controle ao event loop (timers pendentes rodam)", async () => {
    let timer = false;
    setTimeout(() => (timer = true), 0);
    await dorme(1);
    await ceder();
    expect(timer).toBe(true);
  });
});
