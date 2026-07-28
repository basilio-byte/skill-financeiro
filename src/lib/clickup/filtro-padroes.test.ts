import { describe, expect, it } from "vitest";
import { acharSobreposicoes, bateAlgumPadrao, normalizarPadroes, PadroesVazioError } from "@/lib/clickup/filtro-padroes";

describe("normalizarPadroes", () => {
  it("separa por linha, tira espaço e descarta vazios", () => {
    expect(normalizarPadroes("Batial\n  Litoral  \n\nAbissal\n")).toEqual(["Batial", "Litoral", "Abissal"]);
  });

  it("também aceita separado por vírgula", () => {
    expect(normalizarPadroes("Batial, Litoral,Abissal")).toEqual(["Batial", "Litoral", "Abissal"]);
  });

  it("remove duplicatas", () => {
    expect(normalizarPadroes("Batial\nBatial\nLitoral")).toEqual(["Batial", "Litoral"]);
  });

  it("string vazia vira lista vazia", () => {
    expect(normalizarPadroes("")).toEqual([]);
  });
});

describe("bateAlgumPadrao", () => {
  it("casa um padrão que aparece como substring da linha", () => {
    expect(bateAlgumPadrao("Seatech - EV - Endereço Fiscal Batial Mensal (SEATECH)", ["Batial"])).toBe(true);
  });

  it("ignora acento dos dois lados — caso real: 'Comércio' (padrão) casa com 'Comercio' (linha) e vice-versa", () => {
    expect(bateAlgumPadrao("Endereço Fiscal De Comercio Mensal (SEATECH)", ["Comércio"])).toBe(true);
    expect(bateAlgumPadrao("Endereço Fiscal de Comércio Mensal (SEAHUB COWORKING)", ["Comercio"])).toBe(true);
  });

  it("ignora maiúscula/minúscula", () => {
    expect(bateAlgumPadrao("ENDEREÇO FISCAL BATIAL", ["batial"])).toBe(true);
  });

  it("não casa quando nenhum padrão aparece na linha", () => {
    expect(bateAlgumPadrao("Endereço Fiscal Litoral Mensal", ["Batial", "Abissal"])).toBe(false);
  });

  it("OR entre padrões — basta um bater", () => {
    expect(bateAlgumPadrao("Endereço Fiscal Litoral Mensal", ["Batial", "Litoral"])).toBe(true);
  });

  it("lança PadroesVazioError se a lista de padrões estiver vazia", () => {
    expect(() => bateAlgumPadrao("qualquer coisa", [])).toThrow(PadroesVazioError);
  });
});

describe("acharSobreposicoes", () => {
  it("acha uma linha combinada (várias salas) que já bate em outro vínculo ativo — caso real Sebrae", () => {
    const linhas = [
      { servicoOuPlano: "Contrato: Sala 10 - Sebrae Mensal; Contrato: Sala 09 - Sebrae Mensal; Contrato: Sala 08 - Sebrae Mensal" },
    ];
    const outros = [{ id: "v-sala-09", clickUpTaskId: "task-sala-09", padroes: ["Sala 09 - Sebrae"] }];
    const achadas = acharSobreposicoes(linhas, outros);
    expect(achadas).toHaveLength(1);
    expect(achadas[0]?.vinculoId).toBe("v-sala-09");
  });

  it("não acha nada quando as linhas não batem em nenhum outro vínculo", () => {
    const linhas = [{ servicoOuPlano: "Contrato: Sala 05 - Ayrton Senna Mensal" }];
    const outros = [{ id: "v-sala-06", clickUpTaskId: "task-sala-06", padroes: ["Sala 06 - Ayrton Senna"] }];
    expect(acharSobreposicoes(linhas, outros)).toHaveLength(0);
  });

  it("não reporta a mesma linha duas vezes mesmo se bater em mais de um vínculo vizinho", () => {
    const linhas = [{ servicoOuPlano: "Sala 08 - Sebrae; Sala 09 - Sebrae; Sala 10 - Sebrae" }];
    const outros = [
      { id: "v-08", clickUpTaskId: "t-08", padroes: ["Sala 08 - Sebrae"] },
      { id: "v-09", clickUpTaskId: "t-09", padroes: ["Sala 09 - Sebrae"] },
    ];
    expect(acharSobreposicoes(linhas, outros)).toHaveLength(1);
  });

  it("ignora acento/espaço ao comparar, igual bateAlgumPadrao", () => {
    const linhas = [{ servicoOuPlano: "Endereço Fiscal De   Comercio Mensal" }];
    const outros = [{ id: "v-comercio", clickUpTaskId: "t-comercio", padroes: ["Comércio"] }];
    expect(acharSobreposicoes(linhas, outros)).toHaveLength(1);
  });
});
