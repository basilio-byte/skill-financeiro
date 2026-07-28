import { describe, expect, it } from "vitest";
import {
  acharSobreposicoes,
  bateAlgumPadrao,
  linhasExclusivasDoVinculo,
  normalizarPadroes,
  PadroesVazioError,
} from "@/lib/clickup/filtro-padroes";

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

describe("linhasExclusivasDoVinculo", () => {
  const D1 = new Date("2026-07-28T10:00:00Z");
  const D2 = new Date("2026-07-28T11:00:00Z");

  it("mantém a linha quando nenhum outro vínculo bate nela", () => {
    const linhas = [{ servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 01" }];
    const atual = { id: "v-atend-01", clickUpTaskId: "t-01", padroes: ["ATENDIMENTO 01"], criadoEm: D1 };
    expect(linhasExclusivasDoVinculo(linhas, atual, [])).toEqual(linhas);
  });

  it("exclui uma linha combinada que já pertence a um vínculo IRMÃO mais antigo — caso real Seaway Center", () => {
    const linhas = [
      { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 01; [SEAWAY] - SALA DE ATENDIMENTO 02" },
    ];
    const atual = { id: "v-atend-01", clickUpTaskId: "t-01", padroes: ["SALA DE ATENDIMENTO 01"], criadoEm: D2 };
    const outros = [{ id: "v-auditorio", clickUpTaskId: "t-auditorio", padroes: ["AUDITÓRIO"], criadoEm: D1 }];
    expect(linhasExclusivasDoVinculo(linhas, atual, outros)).toHaveLength(0);
  });

  it("mantém a linha quando o vínculo irmão que também bate é MAIS NOVO (o mais antigo sempre vence)", () => {
    const linhas = [{ servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 01" }];
    const atual = { id: "v-auditorio", clickUpTaskId: "t-auditorio", padroes: ["AUDITÓRIO"], criadoEm: D1 };
    const outros = [{ id: "v-atend-01", clickUpTaskId: "t-01", padroes: ["SALA DE ATENDIMENTO 01"], criadoEm: D2 }];
    expect(linhasExclusivasDoVinculo(linhas, atual, outros)).toHaveLength(1);
  });

  it("desempata por id quando criadoEm é idêntico (mesmo resultado dos dois lados)", () => {
    const linha = { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 01" };
    const auditorio = { id: "a-auditorio", clickUpTaskId: "t-auditorio", padroes: ["AUDITÓRIO"], criadoEm: D1 };
    const atendimento = { id: "z-atend-01", clickUpTaskId: "t-01", padroes: ["SALA DE ATENDIMENTO 01"], criadoEm: D1 };
    // "a-auditorio" < "z-atend-01" -> auditório vence o desempate, fica com a linha.
    expect(linhasExclusivasDoVinculo([linha], auditorio, [atendimento])).toHaveLength(1);
    expect(linhasExclusivasDoVinculo([linha], atendimento, [auditorio])).toHaveLength(0);
  });

  it("mantém linhas não combinadas mesmo com vínculos irmãos mais antigos por perto", () => {
    const linhas = [
      { servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02" },
      { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 02" },
    ];
    const atual = { id: "v-atend-02", clickUpTaskId: "t-02", padroes: ["SALA DE ATENDIMENTO 02"], criadoEm: D2 };
    const outros = [{ id: "v-auditorio", clickUpTaskId: "t-auditorio", padroes: ["AUDITÓRIO"], criadoEm: D1 }];
    const resultado = linhasExclusivasDoVinculo(linhas, atual, outros);
    expect(resultado).toEqual([{ servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02" }]);
  });
});
