import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildXlsx, H, T, N, BRL, BRLB, BLANK } from "@/lib/xlsx/writer";
import { buildCategorizationXlsx, type ExportableLine } from "@/lib/categorization/export-xlsx";

/**
 * TRAVA DE COMPATIBILIDADE (ADR-0035): o gerador de .xlsx ganhou recursos novos (datas reais, autofiltro,
 * compressão) para a central de exportação, e a exportação que JÁ existia (`/api/runs/[id]/export`) não pode mudar
 * nem um byte. Os hashes abaixo foram calculados com o código ANTES da extensão do writer; se algum falhar, o
 * comportamento antigo foi alterado — corrija o writer, não o hash.
 */

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function linha(i: number, extra: Partial<ExportableLine> = {}): ExportableLine {
  return {
    crConexaId: 1000 + i,
    unidade: i % 2 ? "SEAHUB COWORKING" : "SEATECH",
    faturamento: "Mensal",
    clienteConexaId: 500 + i,
    cpfCnpj: `12.345.678/0001-${String(i).padStart(2, "0")}`,
    razaoSocial: `Cliente ${i} & Filhos <Ltda> "Aspas" 'apóstrofo'`,
    planoContratado: "Endereço Fiscal Batial Mensal",
    categoria: i % 3 === 0 ? "Salas Privativas -  Sebrae" : "Endereço Fiscal",
    proporcionado: i % 3 === 0 ? "S" : "N",
    tipo: "Recorrente",
    status: "Quitada",
    parcela: `${i}/12`,
    valorRecebidoCat: (100.5 * i).toFixed(2),
    valorRecebidoTotal: (200.25 * i).toFixed(2),
    valorBruto: i % 4 === 0 ? null : "1234.50",
    valorDesconto: "0.00",
    vencimento: dia("2026-07-10"),
    quitacao: dia("2026-07-12"),
    competencia: dia("2026-07-01"),
    emissao: null,
    dataCredito: dia("2026-07-15"),
    conta: "Conta Banco Inter - AG: 0001 CC:1750521-6",
    observacoes: i % 5 === 0 ? "Observação com acentuação: ação, coração, ç" : null,
    tags: null,
    ...extra,
  };
}

describe("compatibilidade do gerador de xlsx (exportação antiga por rodada)", () => {
  it("buildCategorizationXlsx continua byte a byte igual ao de antes da extensão do writer", () => {
    const linhas = Array.from({ length: 12 }, (_, i) => linha(i + 1));
    linhas.push(linha(99, { valorRecebidoCat: "0.00", razaoSocial: null, dataCredito: null, categoria: "Sem Categoria" }));
    const buf = buildCategorizationXlsx(linhas);
    expect(sha256(buf)).toBe("80c835e7de7e22a564ddccad3bd7aa84fce45a13c2a30eb34f989fdaa0ad93a2");
  });

  it("exportação com mais de 500 linhas (o XML sai em fatias de 500) continua byte a byte igual ao HEAD: 499, 500, 501, 1000, 1001 e 1100 linhas", () => {
    // Hashes calculados com o writer de ANTES da extensão (`git show HEAD:src/lib/xlsx/writer.ts`) e conferidos com o
    // atual. Sem estes casos, um laço de fatias com erro de um (perde 1 linha a cada 500) passava em todos os testes e
    // em ambos os hashes de cima (12 linhas), e a exportação de um mês real sairia com linhas faltando.
    const esperados: Record<number, string> = {
      499: "0fb06394e4d99fab58e8f311f5dcc0634cca3c3de2bd69de5c6eac7be9544e80",
      500: "b2c18bf0535293c06ebe49f945bb181ee067143f3d2f02453378395bd52d4e8e",
      501: "62180f5bdf960bffc55828e009bbc51f38d8ebc932a9f12b5bc1e273da5d911c",
      1000: "8fa74de2253ecf9a1334b6b07a7dfe5f03c1ca9992dfb3f0cfd34df0dc31e889",
      1001: "e67dae7abff643292209a7260654782b3143506d31fb565401d82f0e9d7922a4",
      1100: "babc7602106d3baeb4c3c273c5e2593495283a1f2ce639bf9945b64b7e99ed6e",
    };
    for (const [n, hash] of Object.entries(esperados)) {
      const linhas = Array.from({ length: Number(n) }, (_, i) => linha(i + 1, { cpfCnpj: `12.345.678/0001-${String((i + 1) % 100).padStart(2, "0")}` }));
      expect(sha256(buildCategorizationXlsx(linhas)), `${n} linhas`).toBe(hash);
    }
  });

  it("buildXlsx com todos os tipos de célula antigos (texto, número, R$, R$ em negrito, vazio) continua igual", () => {
    const buf = buildXlsx([
      {
        name: "Aba: com [caracteres] proibidos/ e um nome bem comprido demais",
        colWidths: [10, 20, 30],
        rows: [
          [H("Texto"), H("Número"), H("Real")],
          [T("a & b < c"), N("12.5"), BRL("1234.56")],
          [T(""), N(null), BRLB("99.90")],
          [BLANK, N("abc"), BRL("")],
        ],
      },
      { name: "aba compra", rows: [[T("x")]] },
      { name: "ABA compra", rows: [[T("y")]] },
    ]);
    expect(sha256(buf)).toBe("b60d990ef87f65f5025e6cf6e3ee2eec154944d589594e73bb70a5d8f5e50184");
  });
});
