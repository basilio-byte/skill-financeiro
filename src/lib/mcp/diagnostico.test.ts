import { describe, expect, it } from "vitest";
import { causaDoErro, diagnosticarReceita, type RodadaResumo } from "@/lib/mcp/diagnostico";

const AGORA = new Date("2026-10-05T18:00:00Z");
const min = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const r = (status: string, minutosAtras: number, erro: string | null = null): RodadaResumo => ({
  status,
  erro,
  iniciadoEm: min(minutosAtras),
  concluidoEm: status === "RUNNING" ? null : min(minutosAtras),
});

describe("causaDoErro — reconhece a causa pelo texto, inclusive o texto ENGANOSO antigo", () => {
  it("captcha explícito", () => {
    expect(causaDoErro("O Conexa passou a exigir reCAPTCHA no login web")).toMatch(/reCAPTCHA/);
  });

  // A mensagem que ficou dias no painel sem nomear a causa real.
  it("a frase antiga 'verifique usuário/senha' aponta para o captcha como causa conhecida", () => {
    const c = causaDoErro("Login no Conexa falhou — verifique CONEXA_WEB_USERNAME/CONEXA_WEB_PASSWORD (credenciais ou conta bloqueada).");
    expect(c).toMatch(/captcha/i);
  });

  it("sessão expirada, rede e concorrência", () => {
    expect(causaDoErro("Export do Conexa não retornou um xlsx (content-type: text/html)")).toMatch(/HTML/);
    expect(causaDoErro("fetch failed")).toMatch(/rede/i);
    expect(causaDoErro("P2034 write conflict")).toMatch(/concorrência/);
  });

  it("sem erro ou erro desconhecido = sem causa (nunca inventa)", () => {
    expect(causaDoErro(null)).toBeNull();
    expect(causaDoErro("algo totalmente novo")).toBeNull();
  });
});

describe("diagnosticarReceita", () => {
  it("sem nenhuma rodada: sem histórico", () => {
    expect(diagnosticarReceita([], AGORA).situacao).toBe("sem_historico");
  });

  it("rodadas recentes concluídas: saudável", () => {
    const d = diagnosticarReceita([r("DONE", 10), r("DONE", 25)], AGORA);
    expect(d.situacao).toBe("saudavel");
    expect(d.falhasSeguidas).toBe(0);
  });

  it("o cenário real de 2026-10-05: só falhas por captcha → PARADA, e o resumo manda não tratar como atual", () => {
    const d = diagnosticarReceita(
      [r("FAILED", 5, "Login no Conexa falhou — verifique CONEXA_WEB_USERNAME"), r("FAILED", 20, "Login no Conexa falhou"), r("DONE", 60 * 24 * 6)],
      AGORA,
    );
    expect(d.situacao).toBe("parada");
    expect(d.falhasSeguidas).toBe(2);
    expect(d.resumo).toMatch(/RECEITA PARADA/);
    expect(d.resumo).toMatch(/ANTIGO/);
    expect(d.causaProvavel).toMatch(/captcha/i);
  });

  it("uma falha isolada depois de uma concluída recente NÃO é 'parada'", () => {
    expect(diagnosticarReceita([r("FAILED", 5, "fetch failed"), r("DONE", 20)], AGORA).situacao).toBe("saudavel");
  });

  it("sem falha registrada mas sem rodada concluída há mais de 90 min: parada (o agendador pode ter morrido)", () => {
    expect(diagnosticarReceita([r("DONE", 300)], AGORA).situacao).toBe("parada");
  });

  it("nunca houve uma concluída: parada", () => {
    expect(diagnosticarReceita([r("FAILED", 5, "x")], AGORA).situacao).toBe("parada");
  });

  it("RUNNING não quebra a sequência de falhas e sozinho é 'em andamento'", () => {
    expect(diagnosticarReceita([r("RUNNING", 1), r("DONE", 20)], AGORA).situacao).toBe("em_andamento");
    expect(diagnosticarReceita([r("RUNNING", 1), r("FAILED", 20, "x"), r("FAILED", 40, "x"), r("DONE", 9999)], AGORA).falhasSeguidas).toBe(2);
  });

  it("não depende da ordem de entrada", () => {
    const a = diagnosticarReceita([r("DONE", 600), r("FAILED", 5, "x"), r("FAILED", 20, "x")], AGORA);
    const b = diagnosticarReceita([r("FAILED", 20, "x"), r("FAILED", 5, "x"), r("DONE", 600)], AGORA);
    expect(a).toEqual(b);
  });
});

describe("diagnosticarReceita — a janela de rodadas é curta (bug medido em produção, 2026-10-05)", () => {
  it("janela só de falhas + última concluída fora dela: usa a contagem REAL, e a última concluída aparece", () => {
    const janela = Array.from({ length: 40 }, (_, i) => r("FAILED", 5 + i * 15, "Login no Conexa falhou"));
    const ultimaBoa = r("DONE", 60 * 24 * 5);
    // Sem a última concluída na lista, o diagnóstico dizia "nunca" e falhasSeguidas=40.
    const sem = diagnosticarReceita(janela, AGORA);
    expect(sem.ultimaConcluidaEm).toBeNull();
    const com = diagnosticarReceita([...janela, ultimaBoa], AGORA, 190);
    expect(com.ultimaConcluidaEm).not.toBeNull();
    expect(com.falhasSeguidas).toBe(190);
    expect(com.resumo).toMatch(/190 rodada/);
    expect(com.resumo).not.toMatch(/concluída foi nunca/);
  });

  it("a contagem real nunca REDUZ o que a janela já provou", () => {
    expect(diagnosticarReceita([r("FAILED", 5, "x"), r("FAILED", 20, "x"), r("DONE", 9999)], AGORA, 1).falhasSeguidas).toBe(2);
  });
});

describe("diagnosticarReceita — última concluída veio de IMPORTAÇÃO MANUAL", () => {
  const importada = { ...r("DONE", 30), origem: "IMPORTACAO", periodo: "2026-09-01..2026-09-30" };

  it("diz que foi importação manual e até onde ela vale, em vez de só 'retrato antigo'", () => {
    const d = diagnosticarReceita([r("FAILED", 5, "O Conexa passou a exigir reCAPTCHA"), r("FAILED", 20, "O Conexa passou a exigir reCAPTCHA"), importada], AGORA);
    expect(d.situacao).toBe("parada");
    expect(d.resumo).toMatch(/IMPORTAÇÃO MANUAL/);
    expect(d.resumo).toMatch(/2026-09-01\.\.2026-09-30/);
    expect(d.resumo).not.toMatch(/retrato ANTIGO/);
    expect(d.resumo).toMatch(/reCAPTCHA/);
  });

  it("rodada concluída automática continua com o texto de sempre", () => {
    const d = diagnosticarReceita([r("FAILED", 5, "x"), r("FAILED", 20, "x"), { ...r("DONE", 30), origem: "AUTOMATICO" }], AGORA);
    expect(d.resumo).toMatch(/retrato ANTIGO/);
    expect(d.resumo).not.toMatch(/IMPORTAÇÃO MANUAL/);
  });
});
