import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx/writer";
import { lerAba } from "@/lib/xlsx/inspecionar";
import { sum, toAmountString } from "@/lib/money";
import { diasDeAtraso } from "@/lib/inadimplencia/dominio";
import {
  COLUNAS_INAD,
  colunasInad,
  descreverFiltrosInad,
  grupoInadPermitido,
  lerPedidoInadimplencia,
  montarAbasInadimplencia,
  nomeDoArquivoInad,
  type LinhaInadimplencia,
} from "@/lib/exportacao/pasta-inadimplencia";
import { fraseDeFrescorInad } from "@/lib/exportacao/frescor-texto";
import { conferirLeituraDeVolta } from "@/lib/exportacao/conferencia";

/**
 * Hoje as abas de RESUMO vêm DESLIGADAS por padrão (a planilha é para os dados; o painel já resume). Estes testes exercitam os
 * resumos, então pedem explicitamente — a menos que o próprio teste mande `f` (formulário enviado), caso em que vale o que ele mandou.
 */
const comResumos = (params: Record<string, string | string[]>): Record<string, string | string[]> => ("f" in params ? params : { resumos: "1", ...params });

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOJE = "2026-11-04";
const hojeD = dia(HOJE);

function linha(p: Partial<LinhaInadimplencia> & Pick<LinhaInadimplencia, "conexaId" | "valor" | "vencimento">): LinhaInadimplencia {
  return {
    customerConexaId: 100,
    cliente: "Cliente & Filhos",
    unidade: "SEAHUB COWORKING",
    status: "unpaid",
    tipo: "recurring",
    valorOriginal: p.valor,
    competencia: dia("2026-09-01"),
    diasDeAtraso: diasDeAtraso(p.vencimento, hojeD),
    atualizadoNoConexa: dia("2026-11-03"),
    sincronizadoEm: dia("2026-11-04"),
    telefone: "(84) 99999-0000",
    email: "c@x.com",
    ...p,
  };
}

const LINHAS: LinhaInadimplencia[] = [
  linha({ conexaId: 1, valor: "100.10", valorOriginal: "100.00", vencimento: dia("2026-10-30") }), // 5 dias
  linha({ conexaId: 2, valor: "200.00", vencimento: dia("2026-09-15"), customerConexaId: 200, cliente: "Outro Cliente", unidade: "SEATECH", status: "protested" }), // 50
  linha({ conexaId: 3, valor: "300.20", valorOriginal: "300.00", vencimento: dia("2026-07-01"), customerConexaId: 100, status: "juridical" }), // 126
  linha({ conexaId: 4, valor: "50.00", vencimento: dia("2026-11-04"), customerConexaId: null, cliente: "Cliente sem identificação", unidade: null, telefone: null, email: null }), // vence hoje
];
const TOTAL = "650.30";

const base = {
  linhas: LINHAS,
  geradoEm: new Date("2026-11-04T20:00:00Z"),
  usuario: { id: "u", nome: "Admin", email: "a@t", papel: "ADMIN" as const },
  frescor: { texto: "Atualizado em 04/11/2026 16:50 (há 10 min).", alerta: false },
  hoje: HOJE,
};
const pedido = (params: Record<string, string | string[]>) => lerPedidoInadimplencia(comResumos(params)).pedido;

describe("lerPedidoInadimplencia", () => {
  it("sem parâmetros: nada filtrado, resumos DESLIGADOS, sem contato", () => {
    const { pedido: p, erros } = lerPedidoInadimplencia({});
    expect(erros).toEqual([]);
    expect(p.grupos).toEqual([]);
    expect(p.resumos).toBe(false); // a planilha é para os dados; o painel já resume
    expect(p.filtros.status).toBeNull();
  });

  it("valor malformado vira ERRO (a tela ignoraria em silêncio e a exportação entregaria tudo)", () => {
    expect(lerPedidoInadimplencia({ de: "31/10/2026" }).erros[0]).toMatch(/Vencimento inicial inválida/);
    expect(lerPedidoInadimplencia({ ate: "2026-02-31" }).erros[0]).toMatch(/Vencimento final inválida/);
    expect(lerPedidoInadimplencia({ de: "2026-10-31", ate: "2026-10-01" }).erros).toContain("O vencimento inicial é depois do final.");
    expect(lerPedidoInadimplencia({ status: "overdue" }).erros[0]).toMatch(/Situação desconhecida/);
    expect(lerPedidoInadimplencia({ ordem: "nome" }).erros[0]).toMatch(/Ordenação desconhecida/);
    expect(lerPedidoInadimplencia({ dir: "cima" }).erros[0]).toMatch(/Direção desconhecida/);
    expect(lerPedidoInadimplencia({ grupos: "x" }).erros[0]).toMatch(/Grupo de colunas desconhecido/);
    expect(lerPedidoInadimplencia({ q: "a".repeat(81) }).erros[0]).toMatch(/80 caracteres/);
  });

  it("normaliza como a tela: datas viram meia-noite UTC e `negotiated` NÃO é uma situação aceita", () => {
    const { pedido: p } = lerPedidoInadimplencia({ de: "2026-10-01", ate: "2026-10-31", status: "juridical", unidade: "SEATECH", q: "silva", ordem: "vencimento", dir: "asc" });
    expect(p.filtros.de?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(p.filtros.status).toBe("juridical");
    expect(p.filtros.ordem).toBe("vencimento");
    expect(lerPedidoInadimplencia({ status: "negotiated" }).erros[0]).toMatch(/Situação desconhecida/);
  });

  it("f=1: caixa ausente = desmarcada", () => {
    expect(lerPedidoInadimplencia({ f: "1" }).pedido.resumos).toBe(false);
    expect(lerPedidoInadimplencia({ f: "1", grupos: ["datas", "contato"], resumos: "1" }).pedido.grupos).toEqual(["datas", "contato"]);
  });

  it("descrição e nome do arquivo", () => {
    expect(descreverFiltrosInad(pedido({}).filtros)).toEqual([
      ["Vencimento", "todos (sem filtro de data)"],
      ["Outros filtros", "nenhum"],
      ["Ordenação", "valor, maior primeiro"],
    ]);
    expect(nomeDoArquivoInad(pedido({}).filtros, HOJE)).toBe("Inadimplentes_2026-11-04.xlsx");
    expect(nomeDoArquivoInad(pedido({ status: "unpaid" }).filtros, HOJE)).toBe("Inadimplentes_2026-11-04_filtrado.xlsx");
  });
});

describe("colunas e permissões", () => {
  it("contato (telefone/e-mail) só no grupo de administrador", () => {
    expect(COLUNAS_INAD.filter((c) => c.grupo === "contato").map((c) => c.titulo)).toEqual(["Telefone", "E-mail"]);
    expect(colunasInad(["datas"]).map((c) => c.titulo)).not.toContain("Telefone");
    expect(grupoInadPermitido("contato", "VIEWER")).toBe(false);
    expect(grupoInadPermitido("contato", "ADMIN")).toBe(true);
  });

  it("o juro é a diferença exata entre o valor com acréscimos e o original (decimal, sem float)", () => {
    const col = COLUNAS_INAD.find((c) => c.id === "juros")!;
    expect(col.valor(LINHAS[0]!)).toBe("0.10");
    expect(col.valor(linha({ conexaId: 9, valor: "0.30", valorOriginal: "0.10", vencimento: dia("2026-10-01") }))).toBe("0.20");
  });
});

describe("montarAbasInadimplencia", () => {
  it("abas: Leia-me, Por cobrança, Por cliente, Faixas de atraso, Por situação, Por unidade", () => {
    const s = montarAbasInadimplencia({ ...base, pedido: pedido({}) });
    expect(s.abas.map((a) => a.name)).toEqual(["Por cobrança", "Por cliente", "Faixas de atraso", "Por situação", "Por unidade", "Leia-me"]);
    expect(montarAbasInadimplencia({ ...base, pedido: pedido({ f: "1" }) }).abas.map((a) => a.name)).toEqual(["Por cobrança", "Por cliente", "Leia-me"]);
  });

  it("o total é a soma exata dos valores e TODAS as abas fecham com ele", () => {
    const s = montarAbasInadimplencia({ ...base, pedido: pedido({}) });
    expect(toAmountString(s.total)).toBe(TOTAL);
    expect(toAmountString(sum(["0.1", "0.2"]))).toBe("0.30");
    const buf = buildXlsx(s.abas);
    for (const nome of ["Por cliente", "Faixas de atraso", "Por situação", "Por unidade"]) {
      const total = lerAba(buf, nome).linhas.find((r) => r[0] === "TOTAL")!;
      expect(total[nome === "Por cliente" ? 4 : 3], nome).toBe(TOTAL);
    }
  });

  it("faixas de atraso: cada cobrança cai numa faixa e quem vence hoje cai na de 'sem atraso' (a soma sempre fecha)", () => {
    const buf = buildXlsx(montarAbasInadimplencia({ ...base, pedido: pedido({}) }).abas);
    const f = lerAba(buf, "Faixas de atraso").linhas;
    const dados = Object.fromEntries(f.slice(1).filter((r) => r[0] && r[0] !== "TOTAL" && r[1]).map((r) => [r[0], r.slice(1, 4)]));
    expect(dados["até 30 dias"]).toEqual(["1", "1", "100.10"]); // 5 dias
    expect(dados["31 a 60"]).toEqual(["1", "1", "200.00"]); // 50 dias
    expect(dados["mais de 90"]).toEqual(["1", "1", "300.20"]); // 126 dias
    expect(dados["sem atraso (vence hoje ou depois)"]).toEqual(["1", "1", "50.00"]);
    expect(f.find((r) => r[0] === "TOTAL")!.slice(1, 4)).toEqual(["4", "3", TOTAL]); // 3 clientes distintos (100, 200, sem id)
  });

  it("por cliente: soma por devedor, pior situação, maior atraso e vencimento mais antigo", () => {
    const buf = buildXlsx(montarAbasInadimplencia({ ...base, pedido: pedido({}) }).abas);
    const linhas = lerAba(buf, "Por cliente").linhas;
    const cli = linhas.find((r) => r[0] === "100")!;
    expect(cli[3]).toBe("2"); // cobranças 1 e 3
    expect(cli[4]).toBe("400.30");
    expect(cli[5]).toBe("46204"); // 2026-07-01 (a mais antiga)
    expect(cli[6]).toBe("126");
    expect(cli[7]).toBe("Jurídico"); // pior: jurídico > protestada > em aberto
    const ordem = linhas.slice(1).filter((r) => r[0] !== "TOTAL" && r[3] && r[4]).map((r) => r[4]);
    expect(ordem).toEqual(["400.30", "200.00", "50.00"]); // do maior valor para o menor
  });

  it("contato só sai quando o grupo foi pedido, e o Leia-me avisa de dado pessoal", () => {
    const sem = montarAbasInadimplencia({ ...base, pedido: pedido({ f: "1", grupos: "datas", resumos: "1" }) });
    expect(sem.titulosDasColunas).not.toContain("Telefone");
    expect(lerAba(buildXlsx(sem.abas), "Por cliente").linhas[0]).not.toContain("Telefone");
    expect(lerAba(buildXlsx(sem.abas), "Leia-me").linhas.flat().join(" ")).not.toContain("LGPD");
    const com = montarAbasInadimplencia({ ...base, pedido: pedido({ f: "1", grupos: ["contato"], resumos: "1" }) });
    expect(com.titulosDasColunas).toContain("Telefone");
    expect(lerAba(buildXlsx(com.abas), "Por cliente").linhas[0]).toContain("E-mail");
    expect(lerAba(buildXlsx(com.abas), "Leia-me").linhas.flat().join(" ")).toContain("LGPD");
  });

  it("Leia-me: data-base dos dias de atraso, renegociadas fora, frescor e ATENÇÃO quando os dados estão velhos", () => {
    const texto = lerAba(buildXlsx(montarAbasInadimplencia({ ...base, pedido: pedido({}) }).abas), "Leia-me").linhas.map((r) => r.join(" | ")).join("\n");
    expect(texto).toContain("04/11/2026");
    expect(texto).toContain("negotiated");
    expect(texto).toContain("Atualizado em 04/11/2026 16:50");
    expect(texto).toContain("Gerado por | Admin (a@t)");
    const alerta = montarAbasInadimplencia({ ...base, pedido: pedido({}), frescor: { texto: "A última tentativa FALHOU.", alerta: true } });
    expect(lerAba(buildXlsx(alerta.abas), "Leia-me").linhas.find((r) => r[0] === "ATENÇÃO")?.[1]).toBe("A última tentativa FALHOU.");
  });

  it("a leitura de volta confere o arquivo (e acusa número virando texto)", () => {
    const s = montarAbasInadimplencia({ ...base, pedido: pedido({}) });
    const lida = lerAba(buildXlsx(s.abas), "Por cobrança").linhas;
    const esperado = { titulos: s.titulosDasColunas, nLinhas: LINHAS.length, indiceValor: s.detalhe.indiceColunaTotal, total: TOTAL };
    expect(conferirLeituraDeVolta(lida, esperado)).toEqual([]);
    const ruim = lida.map((r) => [...r]);
    ruim[1]![esperado.indiceValor] = "R$ 100,10";
    expect(conferirLeituraDeVolta(ruim, esperado).some((p) => p.includes("não é número"))).toBe(true);
  });
});

describe("frase de atualidade da inadimplência", () => {
  const agora = new Date("2026-11-04T20:00:00Z");
  it("em dia / obsoleta (>6 h) / falhou / nunca sincronizou", () => {
    expect(fraseDeFrescorInad({ em: new Date("2026-11-04T19:30:00Z"), status: "DONE", erro: null }, agora)).toMatchObject({ alerta: false, texto: expect.stringContaining("Atualizado em 04/11/2026 16:30") });
    expect(fraseDeFrescorInad({ em: new Date("2026-11-04T10:00:00Z"), status: "DONE", erro: null }, agora)).toMatchObject({ alerta: true, texto: expect.stringContaining("mais de 6 horas") });
    // o texto bruto do erro só vai para ADMIN (pode citar o endereço do banco ou caminhos do servidor)
    expect(fraseDeFrescorInad({ em: new Date("2026-11-04T19:30:00Z"), status: "FAILED", erro: "HTTP 500" }, agora, true)).toMatchObject({ alerta: true, texto: expect.stringContaining("FALHOU (HTTP 500)") });
    const semErro = fraseDeFrescorInad({ em: new Date("2026-11-04T19:30:00Z"), status: "FAILED", erro: "connect ECONNREFUSED 10.0.0.5:5432\n    at /app/.next/server/x.js" }, agora);
    expect(semErro).toMatchObject({ alerta: true, texto: expect.stringContaining("FALHOU:") });
    expect(semErro.texto).not.toContain("ECONNREFUSED");
    expect(semErro.texto).not.toContain("/app/");
    // para ADMIN, só a primeira linha do erro (sem o rastro de pilha)
    const admin = fraseDeFrescorInad({ em: new Date("2026-11-04T19:30:00Z"), status: "FAILED", erro: "connect ECONNREFUSED 10.0.0.5:5432\n    at /app/.next/server/x.js" }, agora, true);
    expect(admin.texto).toContain("(connect ECONNREFUSED 10.0.0.5:5432)");
    expect(admin.texto).not.toContain("/app/");
    expect(fraseDeFrescorInad({ em: null, status: null, erro: null }, agora)).toMatchObject({ alerta: true, texto: expect.stringContaining("ainda não foi sincronizada") });
  });
});
