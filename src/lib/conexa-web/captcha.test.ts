import { describe, expect, it } from "vitest";
import { respostaPedeCaptcha } from "@/lib/conexa-web/captcha";

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
