import { describe, expect, it } from "vitest";
import {
  acharSobreposicoes,
  bateAlgumPadrao,
  donoDoItem,
  linhasExclusivasDoVinculo,
  normalizarPadroes,
  particionarPorReivindicacao,
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

describe("particionarPorReivindicacao", () => {
  const D1 = new Date("2026-07-28T10:00:00Z");
  const D2 = new Date("2026-07-28T11:00:00Z");
  const auditorio = { id: "v-auditorio", clickUpTaskId: "t-auditorio", padroes: ["AUDITÓRIO"], criadoEm: D1 };
  const atend02 = { id: "v-atend-02", clickUpTaskId: "t-02", padroes: ["SALA DE ATENDIMENTO 02"], criadoEm: D2 };

  it("separa as linhas incluídas das reivindicadas por um vínculo mais antigo, dizendo QUEM ficou com cada uma", () => {
    const propria = { servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02" };
    const combinada = { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 02" };

    const { incluidas, excluidas } = particionarPorReivindicacao([propria, combinada], atend02, [auditorio]);

    expect(incluidas).toEqual([propria]);
    expect(excluidas).toHaveLength(1);
    expect(excluidas[0]?.linha).toEqual(combinada);
    expect(excluidas[0]?.reivindicadaPor.clickUpTaskId).toBe("t-auditorio");
  });

  it("nada é excluído para o vínculo mais antigo — ele fica com a linha combinada", () => {
    const combinada = { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 02" };
    const { incluidas, excluidas } = particionarPorReivindicacao([combinada], auditorio, [atend02]);
    expect(incluidas).toEqual([combinada]);
    expect(excluidas).toEqual([]);
  });

  it("toda linha aparece em EXATAMENTE uma das duas listas — nunca some nem duplica", () => {
    const linhas = [
      { servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02" },
      { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 02" },
      { servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02 - outra fatura" },
    ];
    const { incluidas, excluidas } = particionarPorReivindicacao(linhas, atend02, [auditorio]);
    expect(incluidas.length + excluidas.length).toBe(linhas.length);
  });

  it("é a MESMA decisão de linhasExclusivasDoVinculo (uma é implementada sobre a outra)", () => {
    const linhas = [
      { servicoOuPlano: "[SEAWAY] - SALA DE ATENDIMENTO 02" },
      { servicoOuPlano: "[SEAWAY] - AUDITÓRIO; [SEAWAY] - SALA DE ATENDIMENTO 02" },
    ];
    expect(particionarPorReivindicacao(linhas, atend02, [auditorio]).incluidas).toEqual(
      linhasExclusivasDoVinculo(linhas, atend02, [auditorio]),
    );
  });
});

describe("donoDoItem (divisão por item — ADR-0028)", () => {
  const D1 = new Date("2026-07-28T10:00:00Z");
  const D2 = new Date("2026-07-28T11:00:00Z");
  const cabine = { id: "v-cabine", clickUpTaskId: "t-cabine", padroes: ["[SEAWAY] - Cabine"], criadoEm: D1 };
  const atend02 = { id: "v-a02", clickUpTaskId: "t-a02", padroes: ["SALA DE ATENDIMENTO 02"], criadoEm: D2 };
  const atend03 = { id: "v-a03", clickUpTaskId: "t-a03", padroes: ["SALA DE ATENDIMENTO 03"], criadoEm: D2 };
  const todos = [cabine, atend02, atend03];

  it("cada item da fatura real 27320 vai pro seu próprio dono", () => {
    expect(donoDoItem("[SEAWAY] - Cabine (SEAHUB COWORKING)", todos)?.clickUpTaskId).toBe("t-cabine");
    expect(donoDoItem("[SEAWAY] - SALA DE ATENDIMENTO 02 - 3 pessoas (SEAHUB COWORKING)", todos)?.clickUpTaskId).toBe("t-a02");
    expect(donoDoItem("[SEAWAY] - SALA DE ATENDIMENTO 03 - 3 pessoas (SEAHUB COWORKING)", todos)?.clickUpTaskId).toBe("t-a03");
  });

  it("item que nenhum vínculo casa não vai pra ninguém (não infla quem estava por perto)", () => {
    expect(donoDoItem("[SEAWAY] - SALA DE REUNIÃO 07 (SEAHUB COWORKING)", todos)).toBeNull();
  });

  it("quando 2 vínculos casam o MESMO item, o mais antigo vence (desempate determinístico)", () => {
    const generico = { id: "v-gen", clickUpTaskId: "t-gen", padroes: ["[SEAWAY]"], criadoEm: D1 };
    const especifico = { id: "v-esp", clickUpTaskId: "t-esp", padroes: ["Cabine"], criadoEm: D2 };
    expect(donoDoItem("[SEAWAY] - Cabine", [generico, especifico])?.clickUpTaskId).toBe("t-gen");
    // Ordem da lista não muda o resultado.
    expect(donoDoItem("[SEAWAY] - Cabine", [especifico, generico])?.clickUpTaskId).toBe("t-gen");
  });

  it("empate exato de criadoEm desempata por id, igual à regra de linha", () => {
    const a = { id: "a-um", clickUpTaskId: "t-a", padroes: ["Cabine"], criadoEm: D1 };
    const z = { id: "z-dois", clickUpTaskId: "t-z", padroes: ["Cabine"], criadoEm: D1 };
    expect(donoDoItem("Cabine", [z, a])?.clickUpTaskId).toBe("t-a");
  });

  it("lista vazia de candidatos devolve null em vez de quebrar", () => {
    expect(donoDoItem("[SEAWAY] - Cabine", [])).toBeNull();
  });
});
