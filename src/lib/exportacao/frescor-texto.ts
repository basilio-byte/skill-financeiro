import { dataHoraBr } from "./planilha";
import { plural } from "./plural";

/**
 * As FRASES da atualidade dos dados (ADR-0035) — puras, testáveis. A consulta ao banco mora em `frescor.ts`.
 * A DECISÃO (saudável, parada, importação manual…) é a do diagnóstico do MCP; aqui só se escolhe como dizer, em
 * português e com data no fuso do app (nunca em ISO/UTC): quem lê uma planilha não decodifica "…T19:53:12.235Z".
 */

/** "5 min", "3 h", "2 dias" (a partir de 48 h conta em dias, então nunca é "1 dia"). */
export function haQuanto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 48 * 60) return `${Math.floor(minutos / 60)} h`;
  return `${Math.floor(minutos / 1440)} dias`;
}

export interface DiagnosticoParaFrase {
  situacao: string;
  falhasSeguidas: number;
  minutosDesdeUltimaConcluida: number | null;
  causaProvavel: string | null;
  resumo: string;
}

export function fraseDeFrescor(diag: DiagnosticoParaFrase, concluidaEm: Date | null): string {
  const ultima = concluidaEm
    ? `Última sincronização concluída em ${dataHoraBr(concluidaEm)}${diag.minutosDesdeUltimaConcluida !== null ? ` (há ${haQuanto(diag.minutosDesdeUltimaConcluida)})` : ""}.`
    : "Nenhuma sincronização foi concluída ainda.";
  switch (diag.situacao) {
    case "saudavel":
      return `Receita sincronizando normalmente. ${ultima}`;
    case "em_andamento":
      return `Há uma sincronização em andamento agora. ${ultima}`;
    case "parada":
      return (
        // "Parada" pode vir de falhas em sequência OU só de tempo sem nenhuma rodada concluída: não dizer "0 falhas seguidas".
        `A SINCRONIZAÇÃO DE RECEITA ESTÁ PARADA${diag.falhasSeguidas > 0 ? ` (${diag.falhasSeguidas} ${plural(diag.falhasSeguidas, "falha seguida", "falhas seguidas")})` : ": nenhuma rodada foi concluída recentemente"}. ${ultima} ` +
        `Os valores desta planilha são um retrato ANTIGO: não os apresente como atuais.` +
        (diag.causaProvavel ? ` Causa provável: ${diag.causaProvavel}` : "")
      );
    default:
      // importacao_manual e sem_historico: o resumo do diagnóstico já é a frase certa.
      return diag.resumo;
  }
}

/** Situações em que a planilha precisa levar um ATENÇÃO. */
export function situacaoEmAlerta(situacao: string): boolean {
  return situacao === "parada" || situacao === "sem_historico" || situacao === "importacao_manual";
}

// ---------------------------------------------------------------------------------------------------------------
// Inadimplência: a atualidade do espelho de cobranças em aberto (mesma régua da tela /inadimplentes)
// ---------------------------------------------------------------------------------------------------------------

/** Mais velho que isto, o retrato da dívida merece aviso (o mesmo limite da tela). */
export const INAD_OBSOLETA_APOS_MS = 6 * 60 * 60_000;

export interface SincInadimplencia {
  /** Quando a última tentativa concluiu (ou começou). null = nunca sincronizou. */
  em: Date | null;
  status: string | null;
  erro: string | null;
}

/**
 * `incluirErro`: o texto bruto do último erro (pode citar o endereço do banco, caminhos do servidor) só vai para quem é
 * ADMIN — a mesma regra do grupo "Detalhe técnico" das sincronizações. Para os demais, só se diz que a tentativa falhou.
 */
export function fraseDeFrescorInad(s: SincInadimplencia, agora: Date, incluirErro = false): { texto: string; alerta: boolean } {
  if (s.status === null || s.em === null) {
    return { texto: "A lista de inadimplentes ainda não foi sincronizada: não há dados confiáveis.", alerta: true };
  }
  const quando = `${dataHoraBr(s.em)} (há ${haQuanto(Math.max(0, Math.floor((agora.getTime() - s.em.getTime()) / 60_000)))})`;
  if (s.status === "FAILED") {
    return {
      texto: `A última tentativa de atualização FALHOU${incluirErro && s.erro ? ` (${s.erro.split("\n")[0]!.slice(0, 200)})` : ""}: esta planilha mostra o último retrato bom, de ${quando}.`,
      alerta: true,
    };
  }
  if (agora.getTime() - s.em.getTime() > INAD_OBSOLETA_APOS_MS) {
    return { texto: `Dados de ${quando}: há mais de 6 horas sem atualizar, os valores podem estar desatualizados.`, alerta: true };
  }
  return { texto: `Atualizado em ${quando}.`, alerta: false };
}
