/**
 * O Conexa passou a exigir reCAPTCHA no login web (medido em 2026-10-05; o doc de
 * julho registrava "sem recaptcha"). Sem o captcha resolvido, o POST devolve HTTP 200
 * com a própria tela de login e um toast "Marque o captcha e tente novamente" — e não
 * o 302 de sucesso. Nenhum script resolve isso, e este código NÃO tenta contornar.
 *
 * Exportada e pura para teste: reconhecer ESTA causa evita a mensagem enganosa de
 * "verifique as credenciais" que ficou dias no painel sem apontar o problema real.
 */
export function respostaPedeCaptcha(html: string): boolean {
  return /marque o captcha/i.test(html);
}
