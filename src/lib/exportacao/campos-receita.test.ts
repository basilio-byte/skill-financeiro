import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { CAMPOS_BASE_RECEITA, COLUNAS_RECEITA, camposNecessarios, colunasDosGrupos, type LinhaReceita } from "@/lib/exportacao/colunas-receita";
import { lerFiltrosReceita } from "@/lib/exportacao/filtros-receita";
import { paraLinhaReceita, selecao, type RowBruto } from "@/lib/exportacao/mapeamento-receita";
import { montarAbasReceita } from "@/lib/exportacao/pasta-receita";

/**
 * A leitura do banco é ESTREITA: só as colunas dos grupos escolhidos (ADR-0035). Isso só é seguro se for provado que
 * cada coluna lê SOMENTE o que declara em `campos` — senão uma coluna novinha, sem declaração, sairia vazia em
 * silêncio. Estes testes usam um Proxy que acusa qualquer leitura fora do declarado.
 */

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const completa: LinhaReceita = {
  id: "i1", crConexaId: 1, chaveLinha: "k", unidade: "U", faturamento: "F", clienteConexaId: 5, cpfCnpj: "123", razaoSocial: "R",
  planoContratado: "P", categoria: "C", servicoOuPlano: "S", proporcionado: "N", tipo: "T", status: "Q", parcela: "1/1",
  valorRecebidoCat: "1.00", valorRecebidoTotal: "2.00", valorBruto: "3.00", valorDesconto: "0.00",
  vencimento: dia("2026-10-01"), quitacao: dia("2026-10-02"), competencia: dia("2026-10-03"), emissao: dia("2026-10-04"), dataCredito: dia("2026-10-15"),
  mesCredito: "2026-10", conta: "A", observacoes: "o", tags: "t", ajusteArredondamento: "0.01", revisadoManualmente: true,
  revisadoPorNome: "Duda", revisadoEm: dia("2026-10-20"), categoriaOriginal: "CO", valorRecebidoCatOriginal: "0.50",
  atualizadoEm: dia("2026-11-01"), itensDetalhe: null,
};

/** Proxy que registra cada propriedade lida; se `permitidos` vier, lança ao ler uma fora da lista. */
function espiao(linha: LinhaReceita, permitidos?: ReadonlySet<string>) {
  const lidos = new Set<string>();
  const p = new Proxy(linha, {
    get(alvo, prop) {
      const nome = String(prop);
      lidos.add(nome);
      if (permitidos && !permitidos.has(nome)) throw new Error(`campo não declarado lido: ${nome}`);
      return (alvo as unknown as Record<string, unknown>)[nome];
    },
  });
  return { p, lidos };
}

describe("o catálogo declara exatamente o que cada coluna lê", () => {
  it.each(COLUNAS_RECEITA.map((c) => [c.id, c] as const))("coluna %s lê só os campos que declara — e todos eles", (_id, coluna) => {
    const { p, lidos } = espiao(completa);
    coluna.valor(p);
    expect([...lidos].sort()).toEqual([...coluna.campos].sort());
  });

  it("todo campo declarado existe em LinhaReceita (nenhum erro de digitação)", () => {
    for (const c of COLUNAS_RECEITA) for (const f of c.campos) expect(Object.keys(completa), `${c.id} → ${f}`).toContain(f);
    for (const f of CAMPOS_BASE_RECEITA) expect(Object.keys(completa)).toContain(f);
  });

  it("todo campo declarado vira uma seleção VÁLIDA no modelo do Prisma (nome de coluna real)", () => {
    const colunasDoModelo = new Set<string>(Object.values(Prisma.RevenueCategorizedLineScalarFieldEnum));
    const todos = camposNecessarios(COLUNAS_RECEITA);
    for (const f of todos) {
      if (f === "revisadoPorNome") continue; // vem da relação revisadoPor
      expect(colunasDoModelo.has(f), `campo "${f}" não existe no modelo RevenueCategorizedLine`).toBe(true);
    }
    expect(selecao(new Set(["crConexaId", "revisadoPorNome"]))).toEqual({ crConexaId: true, revisadoPor: { select: { name: true } } });
  });
});

describe("a montagem da pasta só lê campos que a leitura estreita traz", () => {
  it.each([
    ["só essenciais", []],
    ["essenciais + fatura", ["fatura"]],
    ["tudo", ["fatura", "auditoria", "sensiveis"]],
  ])("%s", (_nome, grupos) => {
    const { filtros } = lerFiltrosReceita({ f: "1", grupos, resumos: "1", mes: "2026-10" });
    const permitidos = camposNecessarios(colunasDosGrupos(filtros.grupos));
    const linhas = [1, 2, 3].map((i) => espiao({ ...completa, crConexaId: i, categoria: i === 3 ? "Sem Categoria" : "C" }, permitidos).p);
    // não pode lançar "campo não declarado lido": resumos, Leia-me, conferências e colunas ficam todos dentro do permitido
    expect(() =>
      montarAbasReceita({
        linhas,
        filtros,
        geradoEm: new Date("2026-11-04T20:00:00Z"),
        usuario: { id: "u", nome: "N", email: "n@t", papel: "ADMIN" },
        frescor: { texto: "ok", alerta: false },
        semDataCreditoNoBanco: 0,
        hoje: "2026-11-04",
      }),
    ).not.toThrow();
  });

  it("a prova funciona: um campo fora do permitido É acusado", () => {
    const { p } = espiao(completa, new Set(["crConexaId"]));
    expect(() => COLUNAS_RECEITA.find((c) => c.id === "cliente")!.valor(p)).toThrow(/campo não declarado lido: razaoSocial/);
  });
});

describe("do banco para LinhaReceita", () => {
  const base: RowBruto = { crConexaId: 7, categoria: "C", proporcionado: "S", valorRecebidoCat: new Decimal("10.5") as unknown as Prisma.Decimal, mesCredito: "2026-10", revisadoManualmente: false };

  it("campo não lido fica neutro; dinheiro vira string com 2 casas", () => {
    const l = paraLinhaReceita(base);
    expect(l.valorRecebidoCat).toBe("10.50");
    expect(l.valorRecebidoTotal).toBe("0.00");
    expect(l.cpfCnpj).toBeNull();
    expect(l.observacoes).toBeNull();
    expect(l.revisadoPorNome).toBeNull();
    expect(l.revisadoEm).toBeNull();
  });

  it("converte instantes para o relógio de Fortaleza (UTC-3) e lê o nome de quem revisou", () => {
    const l = paraLinhaReceita({
      ...base,
      revisadoEm: new Date("2026-11-04T20:03:00Z"),
      atualizadoEm: new Date("2026-11-05T01:00:00Z"),
      revisadoPor: { name: "Duda" },
      valorRecebidoTotal: new Decimal("2000") as unknown as Prisma.Decimal,
    });
    expect(l.revisadoEm!.toISOString()).toBe("2026-11-04T17:03:00.000Z");
    expect(l.atualizadoEm.toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(l.revisadoPorNome).toBe("Duda");
    expect(l.valorRecebidoTotal).toBe("2000.00");
  });

  it("a base sempre inclui o que resumos, rodapé e Leia-me usam", () => {
    for (const f of ["crConexaId", "categoria", "valorRecebidoCat", "conta", "unidade", "status", "proporcionado", "mesCredito", "dataCredito", "revisadoManualmente"]) {
      expect(CAMPOS_BASE_RECEITA).toContain(f);
    }
  });
});
