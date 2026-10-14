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

/**
 * A página de login (HTML) TEM o widget do reCAPTCHA? Procura o que o widget realmente é —
 * um elemento com a classe `g-recaptcha`, um `data-sitekey`, o script do Google ou o objeto
 * `grecaptcha` — e NÃO a mera palavra "recaptcha": em 2026-10-14 a página já tinha perdido o
 * widget mas ainda carregava uma regra de CSS órfã `.g-recaptcha { … }`, que não é widget.
 *
 * Só leitura da página pública de login; nada aqui tenta resolver ou contornar captcha.
 */
export function paginaTemWidgetCaptcha(html: string): boolean {
  return (
    /<[^>]*\bclass\s*=\s*["'][^"']*\bg-recaptcha\b[^"']*["']/i.test(html) ||
    /\bdata-sitekey\s*=/i.test(html) ||
    /<script[^>]+src\s*=\s*["'][^"']*recaptcha[^"']*["']/i.test(html) ||
    /\bgrecaptcha\b/i.test(html)
  );
}

/**
 * Decide se a pausa do login pode ser levantada antes das 6 h: SÓ quando o widget SUMIU da
 * página depois de a pausa começar. Se ao pausar a página já não tinha widget (o servidor recusou
 * mesmo assim), a pausa não pode ser levantada por sondagem — senão cada ciclo de 15 min voltaria
 * a tentar e a ser recusado, que é exatamente o que a pausa existe para evitar.
 *
 * @param widgetNaPausa  estado do widget quando a pausa começou (null = não se sabe)
 * @param widgetAgora    estado agora (null = a sondagem falhou → continua pausado)
 */
export function podeLevantarPausa(widgetNaPausa: boolean | null, widgetAgora: boolean | null): boolean {
  return widgetAgora === false && widgetNaPausa !== false;
}
