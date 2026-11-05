import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mensagem de erro ASSINADA (ADR-0035). PURO (recebe o segredo; quem chama o lê do ambiente).
 *
 * Quando um download falha, a rota devolve o navegador para a tela /exportar com a mensagem na URL — e a URL é entrada
 * de qualquer pessoa: um link forjado (`/exportar?erro=Sua sessão expirou, confirme a senha em…`) viraria um alerta
 * vermelho "oficial" dentro de uma página autenticada. Por isso a mensagem viaja com uma assinatura HMAC-SHA256 (feita
 * com o segredo da sessão) e a tela só a mostra se a assinatura confere. Texto de link forjado é ignorado.
 */

const CONTEXTO = "exportar-erro:v1:";
const TAMANHO = 32;

export function assinarMensagem(segredo: string, mensagem: string): string {
  return createHmac("sha256", segredo).update(CONTEXTO + mensagem).digest("hex").slice(0, TAMANHO);
}

/** A mensagem, se (e só se) a assinatura confere; senão "". */
export function mensagemVerificada(segredo: string, mensagem: string, assinatura: string): string {
  if (!mensagem || assinatura.length !== TAMANHO) return "";
  const esperada = Buffer.from(assinarMensagem(segredo, mensagem), "utf8");
  const recebida = Buffer.from(assinatura, "utf8");
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return "";
  return mensagem;
}
