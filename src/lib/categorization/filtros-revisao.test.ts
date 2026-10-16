import { describe, expect, it } from "vitest";
import { lerFiltrosRevisao, temFiltroRevisao } from "@/lib/categorization/filtros-revisao";

describe("lerFiltrosRevisao", () => {
  it("sem parâmetros: nenhum filtro (a tela mostra tudo, como antes)", () => {
    expect(lerFiltrosRevisao({})).toEqual({ mes: null, proporcionado: null });
    expect(temFiltroRevisao(lerFiltrosRevisao({}))).toBe(false);
  });

  it("aceita mês yyyy-MM e proporcionado S ou SEM_LV", () => {
    expect(lerFiltrosRevisao({ mes: "2026-09", proporcionado: "SEM_LV" })).toEqual({ mes: "2026-09", proporcionado: "SEM_LV" });
    expect(lerFiltrosRevisao({ proporcionado: "S" })).toEqual({ mes: null, proporcionado: "S" });
    expect(temFiltroRevisao({ mes: "2026-09", proporcionado: null })).toBe(true);
  });

  it("ignora o que não é válido, sem erro", () => {
    expect(lerFiltrosRevisao({ mes: "2026-13" }).mes).toBeNull();
    expect(lerFiltrosRevisao({ mes: "setembro" }).mes).toBeNull();
    expect(lerFiltrosRevisao({ mes: "2026-9" }).mes).toBeNull();
    expect(lerFiltrosRevisao({ mes: "0000-00" }).mes).toBeNull();
    expect(lerFiltrosRevisao({ mes: "2026-09'; DROP TABLE x;--" }).mes).toBeNull();
    // "N" existe no banco mas não é revisável: não vira filtro (senão a tela mostraria linhas fora da fila).
    expect(lerFiltrosRevisao({ proporcionado: "N" }).proporcionado).toBeNull();
    expect(lerFiltrosRevisao({ proporcionado: "s" }).proporcionado).toBeNull();
  });

  it("parâmetro repetido na URL usa o primeiro", () => {
    expect(lerFiltrosRevisao({ mes: ["2026-09", "2026-08"], proporcionado: ["S", "SEM_LV"] })).toEqual({ mes: "2026-09", proporcionado: "S" });
  });

  it("espaços em volta são tolerados", () => {
    expect(lerFiltrosRevisao({ mes: " 2026-09 " }).mes).toBe("2026-09");
  });
});
