import { describe, expect, it } from "vitest";
import { classificarConflito, type LinhaConflito } from "@/lib/categorization/classificar-conflito";

function linha(overrides: Partial<LinhaConflito> = {}): LinhaConflito {
  return {
    id: "id1",
    categoria: "Sem Categoria",
    chaveLinha: "Sem Categoria",
    servicoOuPlano: "Cliente Avulso",
    valorRecebidoCat: "100.00",
    revisadoManualmente: false,
    revisadoPorNome: null,
    revisadoEm: null,
    categoriaOriginal: null,
    valorRecebidoCatOriginal: null,
    ...overrides,
  };
}

describe("classificarConflito", () => {
  it("duplicata_sem_categoria: automática ainda cai em Sem Categoria, manual tem categoria real (caso real CR 15476)", () => {
    const automatica = linha({ id: "auto", categoria: "Sem Categoria", chaveLinha: "Sem Categoria", revisadoManualmente: false });
    const manual = linha({
      id: "manual",
      categoria: "Salas Privativas - Seaway Center",
      chaveLinha: "Sem Categoria::Cliente Avulso",
      revisadoManualmente: true,
      categoriaOriginal: "Sem Categoria",
    });

    const resultado = classificarConflito([automatica, manual]);
    expect(resultado.tipo).toBe("duplicata_sem_categoria");
    if (resultado.tipo === "duplicata_sem_categoria") {
      expect(resultado.linhaParaExcluirId).toBe("auto");
      expect(resultado.linhaParaRechavearId).toBe("manual");
      expect(resultado.novaChave).toBe("Sem Categoria");
    }
  });

  it("manual_superada: as duas linhas já têm a mesma categoria — uma regra real passou a existir (caso real CR 26553)", () => {
    const automatica = linha({
      id: "auto",
      categoria: "Serviços de Espaço - Seaway Center",
      chaveLinha: "Serviços de Espaço - Seaway Center",
      revisadoManualmente: false,
    });
    const manual = linha({
      id: "manual",
      categoria: "Serviços de Espaço - Seaway Center",
      chaveLinha: "Sem Categoria::Cliente Avulso",
      revisadoManualmente: true,
      categoriaOriginal: "Sem Categoria",
    });

    const resultado = classificarConflito([automatica, manual]);
    expect(resultado.tipo).toBe("manual_superada");
    if (resultado.tipo === "manual_superada") {
      expect(resultado.linhaParaExcluirId).toBe("manual");
    }
  });

  it("ambíguo: categorias divergentes e nenhuma é Sem Categoria", () => {
    const a = linha({ id: "a", categoria: "Outros Serviços", revisadoManualmente: false });
    const b = linha({ id: "b", categoria: "Salas Privativas - Sebrae", revisadoManualmente: true });
    expect(classificarConflito([a, b]).tipo).toBe("ambiguo");
  });

  it("ambíguo: mais de 2 linhas", () => {
    const a = linha({ id: "a", revisadoManualmente: false });
    const b = linha({ id: "b", revisadoManualmente: true });
    const c = linha({ id: "c", revisadoManualmente: false });
    expect(classificarConflito([a, b, c]).tipo).toBe("ambiguo");
  });

  it("ambíguo: duas linhas manuais", () => {
    const a = linha({ id: "a", revisadoManualmente: true });
    const b = linha({ id: "b", revisadoManualmente: true });
    expect(classificarConflito([a, b]).tipo).toBe("ambiguo");
  });

  it("ambíguo: nenhuma linha manual", () => {
    const a = linha({ id: "a", revisadoManualmente: false });
    const b = linha({ id: "b", categoria: "Outra", revisadoManualmente: false });
    expect(classificarConflito([a, b]).tipo).toBe("ambiguo");
  });
});
