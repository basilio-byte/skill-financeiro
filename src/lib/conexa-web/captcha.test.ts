import { describe, expect, it } from "vitest";
import { paginaTemWidgetCaptcha, podeLevantarPausa, respostaPedeCaptcha } from "@/lib/conexa-web/captcha";

describe("respostaPedeCaptcha — a causa real da receita parada (2026-10-05)", () => {
  it("reconhece o toast exato que o Conexa devolve", () => {
    const html = `<script>toastr.error('Marque o captcha e tente novamente', 'Erro');</script>`;
    expect(respostaPedeCaptcha(html)).toBe(true);
  });

  it("não diferencia maiúsculas", () => {
    expect(respostaPedeCaptcha("MARQUE O CAPTCHA")).toBe(true);
  });

  // A tela de login SEMPRE carrega o widget do reCAPTCHA; só a MENSAGEM prova que
  // o servidor recusou por causa dele. Reconhecer o widget daria falso positivo.
  it("a mera presença do widget na página NÃO conta", () => {
    expect(respostaPedeCaptcha('<div class="g-recaptcha" data-sitekey="x" data-action="LOGIN"></div>')).toBe(false);
  });

  it("senha incorreta ou página qualquer não é captcha", () => {
    expect(respostaPedeCaptcha("<p>Usuário ou senha incorretos</p>")).toBe(false);
    expect(respostaPedeCaptcha("")).toBe(false);
  });
});

describe("paginaTemWidgetCaptcha — a página de login ainda carrega o widget?", () => {
  it("reconhece o widget de antes (elemento, sitekey e script do Google)", () => {
    expect(paginaTemWidgetCaptcha('<div class="g-recaptcha" data-sitekey="6Lc" data-action="LOGIN"></div>')).toBe(true);
    expect(paginaTemWidgetCaptcha('<form><div data-sitekey="abc"></div></form>')).toBe(true);
    expect(paginaTemWidgetCaptcha('<script src="https://www.google.com/recaptcha/enterprise.js?render=x"></script>')).toBe(true);
    expect(paginaTemWidgetCaptcha("<script>grecaptcha.enterprise.ready(function(){})</script>")).toBe(true);
  });

  // O caso REAL de 2026-10-14: sem widget, mas com uma regra de CSS órfã. Foi o que fez a primeira
  // checagem por "grep recaptcha" achar 1 ocorrência e quase concluir que o captcha continuava.
  it("uma regra de CSS órfã `.g-recaptcha { … }` NÃO é widget", () => {
    const html = `<style>\n    .g-recaptcha {\n        margin: 8px 0;\n    }\n</style>\n<form id="login-form"><input name="LoginForm[username]"></form>`;
    expect(paginaTemWidgetCaptcha(html)).toBe(false);
  });

  it("página de login sem nada de captcha", () => {
    expect(paginaTemWidgetCaptcha('<form id="login-form"><button id="loginButton">Entrar</button></form>')).toBe(false);
    expect(paginaTemWidgetCaptcha("")).toBe(false);
  });
});

describe("podeLevantarPausa — só levanta cedo se o widget SUMIU depois da pausa", () => {
  it("tinha widget ao pausar e agora não tem: levanta", () => {
    expect(podeLevantarPausa(true, false)).toBe(true);
  });
  it("não se sabia ao pausar (null) e agora não tem: levanta (a primeira vez após um restart)", () => {
    expect(podeLevantarPausa(null, false)).toBe(true);
  });
  it("ao pausar já NÃO tinha widget (recusou mesmo assim): não levanta — evita voltar a bater a cada ciclo", () => {
    expect(podeLevantarPausa(false, false)).toBe(false);
  });
  it("o widget continua lá: não levanta", () => {
    expect(podeLevantarPausa(true, true)).toBe(false);
  });
  it("sondagem falhou (null): continua pausado, nunca levanta no escuro", () => {
    expect(podeLevantarPausa(true, null)).toBe(false);
    expect(podeLevantarPausa(null, null)).toBe(false);
  });
});
