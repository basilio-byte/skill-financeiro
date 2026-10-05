import { describe, expect, it } from "vitest";
import { baseParecidaComApi, montarUrl } from "@/lib/conexa-api/url";

const API = "https://seahubcoworking.conexa.app/index.php/api/v2";

describe("montarUrl — a API v2 não mora na raiz do site", () => {
  it("monta sob /index.php/api/v2, com ou sem barras sobrando", () => {
    expect(montarUrl(API, "charges")).toBe(`${API}/charges`);
    expect(montarUrl(`${API}/`, "/charges")).toBe(`${API}/charges`);
  });

  it("array com [] repete o parâmetro (vírgula devolveria o conjunto errado)", () => {
    const u = montarUrl(API, "customers", { "id[]": [1, 2, 3], limit: 100, offset: 0 });
    expect(u).toContain("id%5B%5D=1&id%5B%5D=2&id%5B%5D=3");
    expect(u).toContain("limit=100");
  });

  it("ignora undefined/null e serializa filtros de status e vencimento", () => {
    const u = montarUrl(API, "charges", { status: "unpaid", dueDateTo: "2026-10-04", x: undefined, y: null });
    expect(u).toBe(`${API}/charges?status=unpaid&dueDateTo=2026-10-04`);
  });
});

describe("baseParecidaComApi — o erro de produção da ADR-0031", () => {
  it("rejeita a raiz do site (que devolve HTML) e aceita a base da API", () => {
    expect(baseParecidaComApi("https://seahubcoworking.conexa.app")).toBe(false);
    expect(baseParecidaComApi("https://seahubcoworking.conexa.app/")).toBe(false);
    expect(baseParecidaComApi(API)).toBe(true);
    expect(baseParecidaComApi(`${API}/`)).toBe(true);
  });
});
