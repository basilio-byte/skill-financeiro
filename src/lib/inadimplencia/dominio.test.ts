import { describe, expect, it } from "vitest";
import {
  contatoDoCliente,
  dataPura,
  diasDeAtraso,
  ehInadimplente,
  FAIXAS_DE_ATRASO,
  intervaloDaFaixa,
  lerFiltros,
  mapearCobranca,
} from "@/lib/inadimplencia/dominio";

const HOJE = new Date(Date.UTC(2026, 9, 5)); // 05/10/2026

const base = { chargeId: 1, customerId: 10, status: "unpaid", amount: 100, dueDate: "2026-09-01" };

describe("ehInadimplente — o que é dívida", () => {
  it("unpaid vencida é inadimplente", () => {
    expect(ehInadimplente(base, HOJE)).toBe(true);
  });

  it("vence HOJE ainda não é atraso; vence ontem é", () => {
    expect(ehInadimplente({ ...base, dueDate: "2026-10-05" }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, dueDate: "2026-10-04" }, HOJE)).toBe(true);
  });

  it("vencimento no futuro nunca é inadimplente", () => {
    expect(ehInadimplente({ ...base, dueDate: "2026-12-01" }, HOJE)).toBe(false);
  });

  it("protestada e jurídica contam como dívida", () => {
    expect(ehInadimplente({ ...base, status: "protested" }, HOJE)).toBe(true);
    expect(ehInadimplente({ ...base, status: "juridical" }, HOJE)).toBe(true);
  });

  // Medido na API: negotiated é a cobrança SUBSTITUÍDA pela renegociação.
  // Listá-la dobraria a dívida.
  it("negotiated NÃO é dívida (a dívida passou para a cobrança nova)", () => {
    expect(ehInadimplente({ ...base, status: "negotiated" }, HOJE)).toBe(false);
  });

  // Medido na API: todas vieram com "Pago em".
  it("generatedByNegotiation e paid NÃO são dívida", () => {
    expect(ehInadimplente({ ...base, status: "generatedByNegotiation" }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, status: "paid" }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, status: "cancelled" }, HOJE)).toBe(false);
  });

  it("sem id, sem status ou sem vencimento legível não é inadimplente", () => {
    expect(ehInadimplente({ ...base, chargeId: undefined }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, status: undefined }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, dueDate: null }, HOJE)).toBe(false);
    expect(ehInadimplente({ ...base, dueDate: "lixo" }, HOJE)).toBe(false);
  });
});

describe("dataPura", () => {
  it("aceita yyyy-MM-dd e ISO completo, sempre meia-noite UTC do dia", () => {
    expect(dataPura("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(dataPura("2026-02-28T23:59:59-03:00")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("rejeita data impossível em vez de normalizar para o mês seguinte", () => {
    expect(dataPura("2026-02-31")).toBeNull();
    expect(dataPura("2026-13-01")).toBeNull();
  });
});

describe("mapearCobranca — valor", () => {
  it("usa currentAmount (COM juros/multa) quando existe, e guarda o original", () => {
    const l = mapearCobranca({ ...base, amount: 100, currentAmount: 112.5 }, HOJE)!;
    expect(l.valor).toBe("112.50");
    expect(l.valorOriginal).toBe("100.00");
  });

  it("sem currentAmount, usa amount nos dois", () => {
    const l = mapearCobranca({ ...base, amount: 90 }, HOJE)!;
    expect(l.valor).toBe("90.00");
    expect(l.valorOriginal).toBe("90.00");
  });

  it("aceita valor como string", () => {
    expect(mapearCobranca({ ...base, amount: "1234.5" }, HOJE)!.valor).toBe("1234.50");
  });

  // "Dívida de R$ 0,00" esconderia um dado quebrado.
  it("sem valor legível descarta a linha — nunca entra com zero", () => {
    expect(mapearCobranca({ ...base, amount: null, currentAmount: null }, HOJE)).toBeNull();
    expect(mapearCobranca({ ...base, amount: "abc" }, HOJE)).toBeNull();
  });

  it("não mapeia o que não é dívida", () => {
    expect(mapearCobranca({ ...base, status: "paid" }, HOJE)).toBeNull();
  });
});

describe("diasDeAtraso", () => {
  it("conta dias corridos e nunca fica negativo", () => {
    expect(diasDeAtraso(new Date(Date.UTC(2026, 8, 5)), HOJE)).toBe(30);
    expect(diasDeAtraso(HOJE, HOJE)).toBe(0);
    expect(diasDeAtraso(new Date(Date.UTC(2026, 11, 1)), HOJE)).toBe(0);
  });
});

describe("contatoDoCliente — formato não confirmado, extração tolerante", () => {
  it("lê string, lista e lista de objetos", () => {
    expect(contatoDoCliente({ cellNumber: "84998678870" }).telefone).toBe("84998678870");
    expect(contatoDoCliente({ phones: ["8433334444", "8455556666"] }).telefone).toBe("8433334444");
    expect(contatoDoCliente({ phones: [{ number: "8433334444" }] }).telefone).toBe("8433334444");
    expect(contatoDoCliente({ emailsFinancialMessages: "a@x.com, b@x.com" }).email).toBe("a@x.com");
    expect(contatoDoCliente({ emailsMessage: [{ email: "c@x.com" }] }).email).toBe("c@x.com");
  });

  it("celular tem prioridade sobre telefone fixo; e-mail financeiro sobre geral", () => {
    expect(contatoDoCliente({ cellNumber: "999", phones: ["333"] }).telefone).toBe("999");
    expect(contatoDoCliente({ emailsFinancialMessages: "fin@x.com", emailsMessage: "geral@x.com" }).email).toBe(
      "fin@x.com",
    );
  });

  it("ausência é null, nunca erro", () => {
    expect(contatoDoCliente({})).toEqual({ telefone: null, email: null });
    expect(contatoDoCliente({ cellNumber: 42, phones: {}, emailsMessage: [] })).toEqual({
      telefone: "42",
      email: null,
    });
  });
});

describe("lerFiltros — a URL nunca derruba a página", () => {
  it("padrão: maior valor primeiro, sem filtro, página 1", () => {
    const f = lerFiltros({});
    expect(f).toMatchObject({ ordem: "valor", direcao: "desc", de: null, ate: null, q: "", status: null, pagina: 1 });
  });

  it("vencimento ordena do mais antigo por padrão; direção explícita vence", () => {
    expect(lerFiltros({ ordem: "vencimento" }).direcao).toBe("asc");
    expect(lerFiltros({ ordem: "vencimento", dir: "desc" }).direcao).toBe("desc");
    expect(lerFiltros({ ordem: "valor", dir: "asc" }).direcao).toBe("asc");
  });

  it("ordem e direção inválidas caem no padrão", () => {
    const f = lerFiltros({ ordem: "'; drop table", dir: "sideways" });
    expect(f.ordem).toBe("valor");
    expect(f.direcao).toBe("desc");
  });

  it("datas inválidas viram 'sem filtro'; intervalo invertido é trocado", () => {
    expect(lerFiltros({ de: "ontem", ate: "2026-02-31" })).toMatchObject({ de: null, ate: null });
    const f = lerFiltros({ de: "2026-09-30", ate: "2026-09-01" });
    expect(f.de?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(f.ate?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("status só aceita os de dívida (negotiated na URL é ignorado)", () => {
    expect(lerFiltros({ status: "protested" }).status).toBe("protested");
    expect(lerFiltros({ status: "negotiated" }).status).toBeNull();
  });

  it("página inválida, zero ou negativa vira 1; absurda é limitada", () => {
    expect(lerFiltros({ pagina: "abc" }).pagina).toBe(1);
    expect(lerFiltros({ pagina: "0" }).pagina).toBe(1);
    expect(lerFiltros({ pagina: "-3" }).pagina).toBe(1);
    expect(lerFiltros({ pagina: "99999999" }).pagina).toBe(10_000);
  });

  it("aceita parâmetro repetido (array) pegando o primeiro", () => {
    expect(lerFiltros({ q: ["silva", "outro"] }).q).toBe("silva");
  });

  it("visão padrão é por cliente; só 'cobranca' muda; lixo cai no padrão", () => {
    expect(lerFiltros({}).visao).toBe("cliente");
    expect(lerFiltros({ visao: "cobranca" }).visao).toBe("cobranca");
    expect(lerFiltros({ visao: "xyz" }).visao).toBe("cliente");
  });

  it("limita o tamanho da busca", () => {
    expect(lerFiltros({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("intervaloDaFaixa — atalhos de atraso viram intervalo de vencimento", () => {
  const faixa = (c: string) => FAIXAS_DE_ATRASO.find((f) => f.chave === c)!;

  it("1-30: vencimento entre 30 e 1 dia atrás", () => {
    // hoje 05/10: 1 dia atrás = 04/10 ; 30 dias atrás = 05/09
    expect(intervaloDaFaixa(faixa("1-30"), HOJE)).toEqual({ de: "2026-09-05", ate: "2026-10-04" });
  });

  it("90+: sem limite inferior de data (a cauda antiga inteira)", () => {
    // 91 dias atrás de 05/10 = 06/07
    expect(intervaloDaFaixa(faixa("90+"), HOJE)).toEqual({ de: null, ate: "2026-07-06" });
  });

  it("as faixas não se sobrepõem: o dia 30 de atraso cai só em 1-30", () => {
    const a = intervaloDaFaixa(faixa("1-30"), HOJE);
    const b = intervaloDaFaixa(faixa("31-60"), HOJE);
    expect(b.ate < a.de!).toBe(true);
  });

  it("o resultado é aceito pelo próprio lerFiltros (ida e volta)", () => {
    const { de, ate } = intervaloDaFaixa(faixa("31-60"), HOJE);
    const f = lerFiltros({ de: de!, ate });
    expect(f.de).not.toBeNull();
    expect(f.ate).not.toBeNull();
  });
});
