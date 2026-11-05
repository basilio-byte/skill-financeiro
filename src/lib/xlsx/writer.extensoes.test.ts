import { describe, expect, it } from "vitest";
import { buildXlsx, buildXlsxAsync, BLANK, D, DT, FBRL, H, HX, INT, PCT, T, W, WB, BRL, N, type Sheet } from "@/lib/xlsx/writer";
import { lerAba, lerParaConferencia, lerParte, lerPartes, lerPasta, lerXml, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { readXlsxRows } from "@/lib/xlsx/reader";

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function abaGrande(n: number): Sheet {
  return {
    name: "Dados",
    rows: [
      [HX("Texto"), HX("Valor"), HX("Data")],
      ...Array.from({ length: n }, (_, i) => [T(`Cliente ${i} & Cia <teste> ação`), BRL((i * 1.25).toFixed(2)), D(dia("2026-10-01"))]),
    ],
  };
}

describe("células novas", () => {
  it("D grava a data-calendário como número de série do Excel (2026-10-01 = 46296)", () => {
    expect(D(dia("2026-10-01"))).toMatchObject({ kind: "num", num: "46296", style: 5 });
    expect(D(dia("2026-11-04"))).toMatchObject({ num: "46330" });
    expect(D(dia("1970-01-01"))).toMatchObject({ num: "25569" });
  });

  it("D lê a data em UTC: meia-noite UTC nunca desliza para o dia anterior, qualquer que seja o fuso do processo", () => {
    // 2026-10-01T00:00:00Z é 30/09 21:00 em Fortaleza — o dia-calendário da coluna @db.Date continua sendo 01/10.
    expect(D(new Date("2026-10-01T00:00:00.000Z")).num).toBe("46296");
    expect(D(new Date("2026-10-01T23:59:59.000Z")).num).toBe("46296");
  });

  it("D e DT de nulo ou data inválida viram célula vazia (nunca 'NaN' no arquivo)", () => {
    expect(D(null)).toBe(BLANK);
    expect(D(undefined)).toBe(BLANK);
    expect(D(new Date("lixo"))).toBe(BLANK);
    expect(DT(null)).toBe(BLANK);
    expect(DT(new Date("lixo"))).toBe(BLANK);
  });

  it("DT grava data e hora de parede com a fração do dia", () => {
    const c = DT(new Date("2026-10-01T12:00:00.000Z"));
    expect(c.style).toBe(6);
    expect(Number(c.num)).toBeCloseTo(46296.5, 8);
    expect(Number(DT(new Date("2026-10-01T18:00:00.000Z")).num)).toBeCloseTo(46296.75, 8);
  });

  it("DT guarda a hora com a precisão do double: nenhum horário erra mais que 1 µs (8 casas deixavam até 0,4 ms a menos e o LibreOffice mostrava um segundo antes: 00:01:00 virava 00:00:59)", () => {
    const erroEmMs = (d: Date, msEsperado: number) => {
      const serial = Number(DT(d).num);
      return Math.abs((serial - Math.floor(serial)) * 86_400_000 - msEsperado);
    };
    for (let m = 0; m < 1440; m++) {
      expect(erroEmMs(new Date(Date.UTC(2026, 10, 4, Math.floor(m / 60), m % 60, 0)), m * 60_000)).toBeLessThan(0.001);
      expect(erroEmMs(new Date(Date.UTC(2026, 6, 28, Math.floor(m / 60), m % 60, 59)), m * 60_000 + 59_000)).toBeLessThan(0.001);
    }
    // o número escrito é o que o JS imprime para o double (sem cortar a fração em poucas casas)
    expect(DT(new Date(Date.UTC(2026, 10, 4, 0, 1, 0))).num).toBe(String(46330 + 1 / 1440));
  });

  it("INT e PCT aceitam só decimal exato; lixo vira texto, nunca número errado", () => {
    expect(INT("1234")).toMatchObject({ kind: "num", num: "1234", style: 9 });
    expect(INT("12abc")).toMatchObject({ kind: "text" });
    expect(PCT("12.34")).toMatchObject({ kind: "num", num: "12.34", style: 3 });
  });

  it("FBRL grava a fórmula com o valor em cache", () => {
    expect(FBRL("SUBTOTAL(109,B2:B9)", "10.50")).toMatchObject({ kind: "formula", formula: "SUBTOTAL(109,B2:B9)", num: "10.50", style: 4 });
  });
});

describe("recursos novos no arquivo", () => {
  const folha: Sheet = {
    name: "Cobranças",
    congelarLinhas: 1,
    autoFiltro: { primeiraLinha: 1, ultimaLinha: 4, ultimaColuna: 2 },
    colWidths: [20, 14, 12],
    rows: [
      [HX("Cliente"), HX("Valor"), HX("Data")],
      [T("A"), BRL("1.50"), D(dia("2026-10-01"))],
      [T("B"), BRL("2.00"), D(dia("2026-10-02"))],
      [T("C"), FBRL("SUBTOTAL(109,B2:B3)", "3.50"), DT(new Date("2026-10-01T12:00:00Z"))],
    ],
  };

  it("painel congelado e autofiltro entram na ORDEM do schema (sheetViews → cols → sheetData → autoFilter)", () => {
    const xml = lerXml(buildXlsx([folha]), "xl/worksheets/sheet1.xml");
    const v = xml.indexOf("<sheetViews>");
    const c = xml.indexOf("<cols>");
    const sd = xml.indexOf("<sheetData>");
    const af = xml.indexOf("<autoFilter");
    expect(v).toBeGreaterThan(-1);
    expect(v).toBeLessThan(c);
    expect(c).toBeLessThan(sd);
    expect(sd).toBeLessThan(af);
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:C4"/>');
  });

  it("usa a folha de estilos estendida e declara <bookViews> só quando há recurso novo", () => {
    const novo = buildXlsx([folha]);
    expect(lerXml(novo, "xl/styles.xml")).toContain('<cellXfs count="14">');
    expect(lerXml(novo, "xl/workbook.xml")).toContain("<bookViews><workbookView/></bookViews>");

    const antigo = buildXlsx([{ name: "x", rows: [[H("a"), BRL("1.00")]] }]);
    expect(lerXml(antigo, "xl/styles.xml")).toContain('<cellXfs count="5">');
    expect(lerXml(antigo, "xl/workbook.xml")).not.toContain("bookViews");
  });

  it("os estilos 0–4 têm o mesmo significado nas duas folhas (nada do que já existia muda de aparência)", () => {
    const antigo = lerXml(buildXlsx([{ name: "x", rows: [[T("a")]] }]), "xl/styles.xml");
    const novo = lerXml(buildXlsx([folha]), "xl/styles.xml");
    const cellXfs = (xml: string) => /<cellXfs[\s\S]*?<\/cellXfs>/.exec(xml)![0].match(/<xf [^>]*>/g)!;
    expect(cellXfs(antigo)).toHaveLength(5);
    expect(cellXfs(novo).slice(0, 5)).toEqual(cellXfs(antigo));
  });

  it("a fórmula sai com <f> e o valor em cache em <v>; a leitura de volta enxerga o cache", () => {
    const buf = buildXlsx([folha]);
    expect(lerXml(buf, "xl/worksheets/sheet1.xml")).toContain("<f>SUBTOTAL(109,B2:B3)</f><v>3.50</v>");
    expect(lerAba(buf, "Cobranças").linhas[3]![1]).toBe("3.50");
  });

  it("datas são números de série com formato de data, não texto", () => {
    const buf = buildXlsx([folha]);
    const xml = lerXml(buf, "xl/worksheets/sheet1.xml");
    expect(xml).toContain('<c r="C2" s="5"><v>46296</v></c>');
    expect(lerAba(buf, "Cobranças").linhas[1]![2]).toBe("46296");
  });
});

describe("compressão DEFLATE (opcional)", () => {
  it("o arquivo comprimido lê de volta idêntico ao sem compressão e é bem menor", () => {
    const folha = abaGrande(3000);
    const plano = buildXlsx([folha]);
    const comprimido = buildXlsx([folha], { comprimir: true });
    expect(comprimido.length).toBeLessThan(plano.length / 4);
    expect(lerAba(comprimido, "Dados").linhas).toEqual(lerAba(plano, "Dados").linhas);
    // O leitor de importação (caminho crítico, só lê a 1ª aba) também aceita o arquivo comprimido.
    expect(readXlsxRows(comprimido)).toEqual(readXlsxRows(plano));
  });

  it("registra o método 8 no diretório central e os tamanhos conferem (o leitor valida tamanho descomprimido)", () => {
    const buf = buildXlsx([abaGrande(50)], { comprimir: true });
    const partes = lerPartes(buf); // lança se o tamanho descomprimido não bater com o do cabeçalho
    expect(partes.has("[Content_Types].xml")).toBe(true);
    expect([...partes.keys()]).toContain("xl/worksheets/sheet1.xml");
    // procura o método no primeiro cabeçalho central
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = buf.readUInt32LE(eocd + 16);
    expect(buf.readUInt16LE(cd + 10)).toBe(8);
  });

  it("sem a opção, continua em STORE (método 0)", () => {
    const buf = buildXlsx([abaGrande(5)]);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(buf.readUInt16LE(buf.readUInt32LE(eocd + 16) + 10)).toBe(0);
  });
});

describe("leitura enxuta para conferência", () => {
  const folha: Sheet = {
    name: "Cobranças",
    congelarLinhas: 1,
    autoFiltro: { primeiraLinha: 1, ultimaLinha: 4, ultimaColuna: 2 },
    rows: [
      [HX("Cliente"), HX("Valor"), HX("Data")],
      [T("A & B"), BRL("1.50"), D(dia("2026-10-01"))],
      [T("C"), BRL("2.00"), D(dia("2026-10-02"))],
      [T("D"), BLANK, D(dia("2026-10-03"))],
      [],
      [H("TOTAL"), BRL("3.50")],
    ],
  };

  it("devolve cabeçalho, coluna de valor e rodapé iguais aos da leitura completa", () => {
    const buf = buildXlsx([{ name: "Leia-me", rows: [[H("x")]] }, folha], { comprimir: true });
    const completa = lerAba(buf, "Cobranças").linhas;
    const enxuta = lerParaConferencia(buf, "Cobranças", 1, 3);
    expect(enxuta[0]).toEqual(completa[0]);
    expect(enxuta[1]![1]).toBe(completa[1]![1]);
    expect(enxuta[2]![1]).toBe(completa[2]![1]);
    expect(enxuta[3]?.[1] ?? "").toBe(""); // a célula de valor em branco da linha 4
    expect(enxuta[5]).toEqual(completa[5]);
    expect(enxuta[5]![0]).toBe("TOTAL");
  });

  it("só descomprime a parte pedida (lerParte) e confere o tamanho", () => {
    const buf = buildXlsx([{ name: "Leia-me", rows: [[H("x")]] }, folha], { comprimir: true });
    expect(lerParte(buf, "xl/workbook.xml").toString("utf8")).toContain("Leia-me");
    expect(() => lerParte(buf, "xl/nao-existe.xml")).toThrow(/não encontrada/);
  });

  it("acusa aba inexistente", () => {
    expect(() => lerParaConferencia(buildXlsx([folha]), "Outra", 1, 3)).toThrow(/não encontrada/);
  });
});

describe("estrutura geral", () => {
  it("várias abas: nomes únicos, sem caracteres proibidos, e cada uma lê de volta no seu lugar", () => {
    const buf = buildXlsx([
      { name: "Leia-me", rows: [[H("Campo"), W("Valor longo\ncom quebra")]] },
      { name: "Por mês", rows: [[HX("Mês"), HX("Valor")], [T("2026-10"), BRL("10.00")]] },
      { name: "Por mês", rows: [[T("repetida")]] },
    ]);
    expect(nomesDasAbas(buf)).toEqual(["Leia-me", "Por mês", "Por mês 2"]);
    const abas = lerPasta(buf);
    expect(abas[1]!.linhas[1]).toEqual(["2026-10", "10.00"]);
    expect(abas[0]!.linhas[0]![1]).toBe("Valor longo\ncom quebra");
  });

  it("célula vazia com estilo não engole a célula seguinte (leitor de inspeção)", () => {
    const buf = buildXlsx([{ name: "x", rows: [[D(null), T("depois"), BLANK, N("7")]] }]);
    expect(lerAba(buf, "x").linhas[0]).toEqual(["", "depois", "", "7"]);
  });
});

describe("buildXlsxAsync: o MESMO arquivo, sem prender o event loop", () => {
  const cede = () => new Promise<void>((r) => setImmediate(r));

  it("byte a byte igual ao síncrono (STORE e DEFLATE), com várias abas e mais de 1.000 linhas", async () => {
    const abas: Sheet[] = [abaGrande(1100), { name: "Leia-me", rows: [[WB("rótulo"), W("b\nc")]] }, abaGrande(3)];
    for (const comprimir of [false, true]) {
      const sinc = buildXlsx(abas, { comprimir });
      const assinc = await buildXlsxAsync(abas, { comprimir });
      expect(Buffer.compare(sinc, assinc), `comprimir=${comprimir}`).toBe(0);
    }
  });

  it("parte com mais de 4 MB: o CRC em pedaços dá o mesmo resultado do CRC de uma vez", async () => {
    const grande: Sheet = { name: "Grande", rows: Array.from({ length: 130 }, (_, i) => [T(`${i} ` + "ação ".repeat(10_000))]) };
    const sinc = buildXlsx([grande]);
    expect(sinc.length).toBeGreaterThan(5_000_000);
    expect(Buffer.compare(sinc, await buildXlsxAsync([grande]))).toBe(0);
  });

  it("cede o controle: uma vez por fatia de 500 linhas e entre as partes do ZIP", async () => {
    let cedeu = 0;
    await buildXlsxAsync([abaGrande(2600)], { comprimir: true }, async () => {
      cedeu += 1;
      await cede();
    });
    expect(cedeu).toBeGreaterThanOrEqual(6 + 6); // 6 fatias de XML + 1 por parte do ZIP
  });

  it("uma cessão que lança (exportação cancelada ou fora do prazo) interrompe a montagem", async () => {
    await expect(
      buildXlsxAsync([abaGrande(2000)], {}, async () => {
        throw new Error("cancelada");
      }),
    ).rejects.toThrow("cancelada");
  });

  it("o estilo 13 (negrito com quebra, topo) está na folha de estilos e o arquivo abre", () => {
    const buf = buildXlsx([{ name: "x", rows: [[WB("rótulo longo"), W("valor")]] }]);
    expect(lerXml(buf, "xl/styles.xml")).toContain('<alignment vertical="top" wrapText="1"/></xf>\n</cellXfs>');
    expect(lerXml(buf, "xl/worksheets/sheet1.xml")).toContain('<c r="A1" s="13" t="inlineStr">');
    expect(lerAba(buf, "x").linhas[0]).toEqual(["rótulo longo", "valor"]);
  });
});
