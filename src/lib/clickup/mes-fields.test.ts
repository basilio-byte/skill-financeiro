import { describe, expect, it } from "vitest";
import { resolverCamposPorMes, type ClickUpField } from "@/lib/clickup/mes-fields";

function field(overrides: Partial<ClickUpField> = {}): ClickUpField {
  return { id: "id", name: "", type: "currency", ...overrides };
}

describe("resolverCamposPorMes", () => {
  it("casa os 12 meses pelo nome, incluindo acentos (Março)", () => {
    const fields = [
      field({ id: "f-jan", name: "Janeiro" }),
      field({ id: "f-mar", name: "Março" }),
      field({ id: "f-dez", name: "Dezembro" }),
    ];
    const campos = resolverCamposPorMes(fields);
    expect(campos[1]).toBe("f-jan");
    expect(campos[3]).toBe("f-mar");
    expect(campos[12]).toBe("f-dez");
  });

  it('casa "Novembo" (typo real de produção, sem o R) com novembro', () => {
    const campos = resolverCamposPorMes([field({ id: "f-nov", name: "Novembo" })]);
    expect(campos[11]).toBe("f-nov");
  });

  it("ignora campos que não são do tipo currency", () => {
    const campos = resolverCamposPorMes([
      field({ id: "f-drop", name: "Janeiro", type: "drop_down" }),
      field({ id: "f-formula", name: "Fevereiro", type: "formula" }),
    ]);
    expect(campos[1]).toBeUndefined();
    expect(campos[2]).toBeUndefined();
  });

  it("ignora campos currency cujo nome não bate com nenhum mês", () => {
    const campos = resolverCamposPorMes([field({ id: "f-contrato", name: "VALOR CONTRATO" })]);
    expect(Object.keys(campos)).toHaveLength(0);
  });

  it("em ambiguidade (duas variantes do mesmo mês, ex.: Novembro e Novembo coexistindo), o primeiro encontrado vence", () => {
    const campos = resolverCamposPorMes([
      field({ id: "f-primeiro", name: "Novembro" }),
      field({ id: "f-segundo", name: "Novembo" }),
    ]);
    expect(campos[11]).toBe("f-primeiro");
  });

  it("NUNCA casa por prefixo — campos currency reais cujo nome só compartilha 3 letras com um mês não roubam o lugar do mês de verdade (achado de revisão adversarial 2026-07-27)", () => {
    const campos = resolverCamposPorMes([
      field({ id: "f-novidades", name: "Novidades" }), // prefixo "nov" (novembro)
      field({ id: "f-setor", name: "Setor Comercial" }), // prefixo "set" (setembro)
      field({ id: "f-margem", name: "Margem de Lucro" }), // prefixo "mar" (março)
      field({ id: "f-outros", name: "Outros Custos" }), // prefixo "out" (outubro)
    ]);
    expect(Object.keys(campos)).toHaveLength(0);
  });

  it("nome com sufixo/anotação (ex.: 'Janeiro 2026') não casa — só o nome exato de um mês é aceito", () => {
    const campos = resolverCamposPorMes([field({ id: "f-jan-2026", name: "Janeiro 2026" })]);
    expect(campos[1]).toBeUndefined();
  });
});
