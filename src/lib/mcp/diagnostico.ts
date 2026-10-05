/**
 * Diagnóstico PURO da saúde da sincronização de receita — sem banco, sem relógio
 * implícito. É o que `estado_do_sistema` usa para dizer "a receita está parada, e
 * por quê", e existe porque o MCP vai ser lido por um agente: um agente que vê
 * "R$ 0,00 em outubro" sem esse aviso conclui "não entrou dinheiro", quando a
 * verdade é "nada foi sincronizado".
 */

export interface RodadaResumo {
  status: string; // DONE | FAILED | RUNNING
  erro: string | null;
  iniciadoEm: Date;
  concluidoEm: Date | null;
  /** MANUAL | AUTOMATICO | IMPORTACAO — opcional (rodadas antigas de teste não o trazem). */
  origem?: string;
  /** Período da rodada, "yyyy-mm-dd..yyyy-mm-dd" — só para dizer até quando uma importação vale. */
  periodo?: string;
}

export type SituacaoReceita = "saudavel" | "parada" | "sem_historico" | "em_andamento";

export interface DiagnosticoReceita {
  situacao: SituacaoReceita;
  /** Rodadas FAILED consecutivas, da mais recente para trás, até achar uma DONE. */
  falhasSeguidas: number;
  ultimaConcluidaEm: string | null;
  minutosDesdeUltimaConcluida: number | null;
  causaProvavel: string | null;
  /** Frase pronta para o agente repetir ao usuário. */
  resumo: string;
}

/** Quantos minutos sem rodada concluída contam como "parada" mesmo sem falha registrada. */
const SEM_RODADA_MIN = 90;

/**
 * Classifica a causa pelo TEXTO do erro. A ordem importa: a mais específica primeiro.
 * ⚠ O texto antigo do app dizia "verifique usuário/senha" mesmo quando era captcha, e
 * isso escondeu a causa por dias (2026-10-05) — por isso a mensagem do erro agora
 * nomeia a causa, e aqui a reconhecemos também em rodadas ANTIGAS gravadas com a frase
 * enganosa (que não menciona captcha).
 */
export function causaDoErro(erro: string | null | undefined): string | null {
  if (!erro) return null;
  if (/captcha/i.test(erro)) {
    return "O Conexa exige reCAPTCHA no login web (medido em 2026-10-05). Nenhuma automação resolve: use a importação manual (Sincronizações → Importar arquivos do Conexa) ou espere o Conexa dispensar o captcha.";
  }
  if (/Login no Conexa falhou/i.test(erro)) {
    return "Login web no Conexa recusado. Desde 2026-10-05 a causa conhecida é o reCAPTCHA (a mensagem antiga dizia 'verifique usuário e senha', o que era enganoso); confira primeiro o toast 'Marque o captcha'.";
  }
  if (/sess[aã]o expirada|n[aã]o retornou um xlsx/i.test(erro)) {
    return "O export do Conexa devolveu HTML em vez de planilha: sessão expirada ou tela de login no meio do caminho.";
  }
  if (/timeout|aborted|ECONNRESET|fetch failed/i.test(erro)) {
    return "Falha de rede ou timeout ao falar com o Conexa.";
  }
  if (/P2034|serializa/i.test(erro)) {
    return "Conflito de concorrência transitório no banco (costuma passar na rodada seguinte).";
  }
  return null;
}

/**
 * @param falhasReais quantas rodadas FAILED existem desde a última concluída, contadas no
 *   BANCO. A janela de `rodadas` é curta (as mais recentes) e, com a receita parada há dias,
 *   TODAS são falhas — sem isto o diagnóstico dizia "última concluída: nunca" e cravava o
 *   número de falhas no tamanho da janela (medido em produção, 2026-10-05).
 */
export function diagnosticarReceita(rodadas: RodadaResumo[], agora: Date, falhasReais?: number): DiagnosticoReceita {
  if (rodadas.length === 0) {
    return {
      situacao: "sem_historico",
      falhasSeguidas: 0,
      ultimaConcluidaEm: null,
      minutosDesdeUltimaConcluida: null,
      causaProvavel: null,
      resumo: "Nenhuma rodada de receita registrada: o banco pode estar vazio ou nunca sincronizou.",
    };
  }

  // Mais recente primeiro.
  const ordenadas = [...rodadas].sort((a, b) => b.iniciadoEm.getTime() - a.iniciadoEm.getTime());
  const ultimaDone = ordenadas.find((r) => r.status === "DONE");
  const ultimaConcluidaEm = ultimaDone ? (ultimaDone.concluidoEm ?? ultimaDone.iniciadoEm) : null;
  const minutos = ultimaConcluidaEm ? Math.floor((agora.getTime() - ultimaConcluidaEm.getTime()) / 60_000) : null;

  let falhasSeguidas = 0;
  for (const r of ordenadas) {
    if (r.status === "FAILED") falhasSeguidas += 1;
    else if (r.status === "DONE") break;
    // RUNNING não conta nem quebra a sequência.
  }

  if (falhasReais !== undefined && falhasReais > falhasSeguidas) falhasSeguidas = falhasReais;

  const maisRecente = ordenadas[0]!;
  const causa = causaDoErro(ordenadas.find((r) => r.status === "FAILED")?.erro);

  let situacao: SituacaoReceita;
  if (maisRecente.status === "RUNNING" && falhasSeguidas === 0) situacao = "em_andamento";
  else if (falhasSeguidas >= 2 || (minutos !== null && minutos > SEM_RODADA_MIN) || !ultimaDone) situacao = "parada";
  else situacao = "saudavel";

  const quando = ultimaConcluidaEm ? `${ultimaConcluidaEm.toISOString()} (há ${minutos} min)` : "nunca";
  const resumo =
    situacao === "parada"
      ? `RECEITA PARADA: ${falhasSeguidas} rodada(s) falharam em sequência; a última concluída foi ${quando}. ` +
        (ultimaDone?.origem === "IMPORTACAO"
          ? `A última rodada concluída foi uma IMPORTAÇÃO MANUAL de arquivos${ultimaDone.periodo ? ` (período ${ultimaDone.periodo})` : ""}: a sincronização automática segue falhando, então o painel só vale até onde os arquivos importados alcançam — não apresente o que veio depois como atuais.`
          : "Os totais do painel são um retrato ANTIGO — não os apresente como atuais.") +
        (causa ? ` Causa provável: ${causa}` : "")
      : situacao === "em_andamento"
        ? "Uma rodada está em andamento agora."
        : `Receita sincronizando normalmente; última rodada concluída ${quando}.`;

  return { situacao, falhasSeguidas, ultimaConcluidaEm: ultimaConcluidaEm?.toISOString() ?? null, minutosDesdeUltimaConcluida: minutos, causaProvavel: causa, resumo };
}
