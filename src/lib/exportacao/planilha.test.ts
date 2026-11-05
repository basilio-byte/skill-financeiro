import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx/writer";
import { lerAba, lerXml } from "@/lib/xlsx/inspecionar";
import { abaDeDetalhe, abaDeTabela, abaLeiaMe, celulaDe, dataHoraBr, letraDaColuna } from "@/lib/exportacao/planilha";
import { paraParede } from "@/lib/exportacao/planilha";
import { fraseDeFrescor, haQuanto, situacaoEmAlerta } from "@/lib/exportacao/frescor-texto";
import { paraQueryString, paramsDe } from "@/lib/exportacao/params";
import type { ColunaDef } from "@/lib/exportacao/tipos";


interface L {
  nome: string;
  valor: string;
}
const COLUNAS: ColunaDef<L>[] = [
  { id: "nome", titulo: "Nome", grupo: "essenciais", tipo: "texto", largura: 20, valor: (l) => l.nome, campos: ["nome"] },
  { id: "valor", titulo: "Valor", grupo: "essenciais", tipo: "dinheiro", largura: 12, valor: (l) => l.valor, campos: ["valor"] },
];

describe("letraDaColuna", () => {
  it("A..Z, AA.. (índice 0-based)", () => {
    expect(letraDaColuna(0)).toBe("A");
    expect(letraDaColuna(25)).toBe("Z");
    expect(letraDaColuna(26)).toBe("AA");
    expect(letraDaColuna(27)).toBe("AB");
    expect(letraDaColuna(51)).toBe("AZ");
    expect(letraDaColuna(52)).toBe("BA");
    expect(letraDaColuna(701)).toBe("ZZ");
    expect(letraDaColuna(702)).toBe("AAA");
  });
});

describe("abaDeDetalhe — o TOTAL acompanha o filtro do Excel", () => {
  it("rodapé em SUBTOTAL(109) sobre as linhas de dados, com o valor exato em cache, FORA do autofiltro", () => {
    const { aba, total, ultimaLinhaDados } = abaDeDetalhe({ nome: "D", colunas: COLUNAS, linhas: [{ nome: "a", valor: "0.10" }, { nome: "b", valor: "0.20" }], colunaTotal: "valor" });
    expect(total).toBe("0.30"); // decimal exato (em float seria 0.30000000000000004)
    expect(ultimaLinhaDados).toBe(3);
    const buf = buildXlsx([aba]);
    const xml = lerXml(buf, "xl/worksheets/sheet1.xml");
    expect(xml).toContain("<f>SUBTOTAL(109,B2:B3)</f><v>0.30</v>");
    expect(xml).toContain('<autoFilter ref="A1:B3"/>'); // o rodapé (linha 5) não entra no filtro
    const l = lerAba(buf, "D").linhas;
    expect(l[3]).toEqual([]); // linha em branco entre os dados e o total
    expect(l[4]).toEqual(["TOTAL", "0.30"]);
  });

  it("sem linhas de dados, o total é estático (não existe intervalo a somar)", () => {
    const { aba, total } = abaDeDetalhe({ nome: "D", colunas: COLUNAS, linhas: [], colunaTotal: "valor" });
    expect(total).toBe("0.00");
    expect(lerXml(buildXlsx([aba]), "xl/worksheets/sheet1.xml")).not.toContain("<f>");
  });

  it("sem coluna de total, não há rodapé", () => {
    const { aba, total, indiceColunaTotal } = abaDeDetalhe({ nome: "D", colunas: COLUNAS, linhas: [{ nome: "a", valor: "1.00" }] });
    expect(total).toBeNull();
    expect(indiceColunaTotal).toBe(-1);
    expect(aba.rows).toHaveLength(2);
  });
});

describe("abaDeTabela", () => {
  it("TOTAL por tipo de coluna, nota abaixo e filtro só quando pedido", () => {
    const aba = abaDeTabela({
      nome: "T",
      colunas: [{ titulo: "Chave", tipo: "texto", largura: 10 }, { titulo: "Qtd", tipo: "inteiro", largura: 6 }, { titulo: "R$", tipo: "dinheiro", largura: 10 }, { titulo: "%", tipo: "percentual", largura: 6 }],
      linhas: [["a", 2, "10.50", "40.00"], ["b", 3, "15.75", "60.00"]],
      total: ["TOTAL", 5, "26.25", "100.00"],
      nota: "uma nota",
    });
    expect(aba.autoFiltro).toEqual({ primeiraLinha: 1, ultimaLinha: 3, ultimaColuna: 3 });
    const l = lerAba(buildXlsx([aba]), "T").linhas;
    expect(l[4]).toEqual(["TOTAL", "5", "26.25", "100.00"]);
    expect(l[6]![0]).toBe("uma nota");
    expect(abaDeTabela({ nome: "T", colunas: [{ titulo: "A", tipo: "texto", largura: 5 }], linhas: [], autoFiltro: false }).autoFiltro).toBeUndefined();
  });
});

describe("abaLeiaMe", () => {
  it("campos, resultado, avisos numerados e ATENÇÃO só quando o frescor alerta", () => {
    const base = { titulo: "Título", geradoEm: new Date("2026-11-04T20:00:00Z"), geradoPor: "N (e@x)", filtros: [["F", "v"]] as Array<[string, string]>, resultado: [["R", "1"]] as Array<[string, string]>, avisos: ["a1", "a2"], conferencia: "ok" };
    const normal = lerAba(buildXlsx([abaLeiaMe({ ...base, frescor: { texto: "em dia", alerta: false } })]), "Leia-me").linhas;
    expect(normal.find((r) => r[0] === "Situação")?.[1]).toBe("em dia");
    expect(normal.map((r) => r[0])).toContain("Atenção 2");
    expect(normal.find((r) => r[0] === "Gerado em")?.[1]).toBe("04/11/2026 17:00");
    const alerta = lerAba(buildXlsx([abaLeiaMe({ ...base, frescor: { texto: "parada", alerta: true } })]), "Leia-me").linhas;
    expect(alerta.find((r) => r[0] === "ATENÇÃO")?.[1]).toBe("parada");
  });
});

describe("datas e células", () => {
  it("relógio de parede de Fortaleza e formato de data e hora", () => {
    expect(paraParede(new Date("2026-11-04T20:03:00Z")).toISOString()).toBe("2026-11-04T17:03:00.000Z");
    expect(dataHoraBr(new Date("2026-11-05T02:59:00Z"))).toBe("04/11/2026 23:59");
    expect(dataHoraBr(new Date("2026-11-05T03:00:00Z"))).toBe("05/11/2026 00:00"); // meia-noite não vira "24:00"
  });

  it("célula de texto vazio e valores nulos viram célula vazia; id numérico sem formato", () => {
    expect(celulaDe("texto", "")).toMatchObject({ kind: "blank" });
    expect(celulaDe("id", 7)).toMatchObject({ kind: "num", num: "7", style: 0 });
    expect(celulaDe("inteiro", 0)).toMatchObject({ kind: "num", num: "0" });
  });
});

describe("frases de atualidade da receita", () => {
  const diag = (situacao: string, extra = {}) => ({ situacao, falhasSeguidas: 3, minutosDesdeUltimaConcluida: 90, causaProvavel: null, resumo: "resumo do diagnóstico", ...extra });
  const quando = new Date("2026-11-04T19:53:00Z");

  it("saudável, em andamento, parada (com causa) e os estados que usam o resumo", () => {
    expect(fraseDeFrescor(diag("saudavel", { minutosDesdeUltimaConcluida: 10 }), quando)).toBe("Receita sincronizando normalmente. Última sincronização concluída em 04/11/2026 16:53 (há 10 min).");
    expect(fraseDeFrescor(diag("em_andamento"), quando)).toContain("Há uma sincronização em andamento");
    const parada = fraseDeFrescor(diag("parada", { causaProvavel: "captcha" }), quando);
    expect(parada).toContain("ESTÁ PARADA (3 falhas seguidas)");
    expect(parada).toContain("retrato ANTIGO");
    expect(parada).toContain("Causa provável: captcha");
    // parada só por tempo (sem falhas registradas): não diz "0 falha(s) seguidas"
    const porTempo = fraseDeFrescor(diag("parada", { falhasSeguidas: 0, minutosDesdeUltimaConcluida: 200 }), quando);
    expect(porTempo).toContain("ESTÁ PARADA: nenhuma rodada foi concluída recentemente.");
    expect(porTempo).not.toContain("0 falha");
    expect(fraseDeFrescor(diag("importacao_manual"), quando)).toBe("resumo do diagnóstico");
    expect(fraseDeFrescor(diag("saudavel"), null)).toContain("Nenhuma sincronização foi concluída ainda");
  });

  it("alerta só para parada, sem histórico e importação manual; haQuanto", () => {
    expect(["saudavel", "em_andamento"].map(situacaoEmAlerta)).toEqual([false, false]);
    expect(["parada", "sem_historico", "importacao_manual"].map(situacaoEmAlerta)).toEqual([true, true, true]);
    expect([5, 59, 60, 125, 47 * 60, 48 * 60, 5000].map(haQuanto)).toEqual(["5 min", "59 min", "1 h", "2 h", "47 h", "2 dias", "3 dias"]);
  });
});

describe("parâmetros da URL", () => {
  it("chave repetida vira lista, chaves perigosas são descartadas e o objeto não tem protótipo", () => {
    const p = paramsDe(new URLSearchParams("a=1&a=2&b=3&__proto__=x&constructor=y&prototype=z"));
    expect(p.a).toEqual(["1", "2"]);
    expect(p.b).toBe("3");
    expect(Object.keys(p)).toEqual(["a", "b"]);
    expect(Object.getPrototypeOf(p)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // nada vazou para o Object.prototype
  });

  it("paraQueryString preserva os valores, aplica extras e ignora chaves", () => {
    const qs = paraQueryString({ a: ["1", "2"], b: "3", erro: "velho", c: undefined }, { dataset: "receita", erro: "novo" }, ["erro"]);
    expect(new URLSearchParams(qs).getAll("a")).toEqual(["1", "2"]);
    expect(new URLSearchParams(qs).get("b")).toBe("3");
    expect(new URLSearchParams(qs).get("erro")).toBe("novo");
    expect(new URLSearchParams(qs).get("dataset")).toBe("receita");
    expect(new URLSearchParams(qs).has("c")).toBe(false);
  });
});
