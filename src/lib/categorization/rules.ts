/**
 * Motor de categorização — porta a lógica do categoriza_receita.py (skill
 * OpenClaw) para TS puro/testável. Ordem de prioridade (ver
 * docs/context/decisions.md para a exceção documentada ao princípio
 * "nunca chutar categoria pelo nome"):
 *
 *  1. Correspondência exata do nome do serviço/plano na tabela de categorias.
 *  2. Correspondência exata ignorando sufixo "Mensal/Anual/Bianual (SEAHUB COWORKING|SEATECH)".
 *  3. Maior prefixo cadastrado na tabela que combina com o nome.
 *  4. Fallbacks fixos (unidades/pacotes conhecidos sem entrada na tabela).
 *  5. "Sem Categoria".
 */

export interface CategoryRule {
  nome: string;
  categoria: string;
}

export type MatchType = "exato" | "sufixo" | "prefixo" | "fallback" | "sem_categoria";

export interface CategorizationMatch {
  categoria: string;
  matchType: MatchType;
}

const SUFFIX_RE = /\s*(Mensal|Anual|Bianual)\s*\((SEAHUB COWORKING|SEATECH)\)\s*$/i;

const FIXED_FALLBACKS: Array<{ test: (nome: string) => boolean; categoria: string }> = [
  { test: (n) => n.startsWith("[SEAWAY] -"), categoria: "Serviços de Espaço - Seaway Center" },
  { test: (n) => n.startsWith("[AYRTON SENNA] -"), categoria: "Serviços de Espaço -  Ayrton Senna" },
  { test: (n) => n.startsWith("[SEBRAE] -"), categoria: "Serviços de Espaço -  Sebrae" },
  { test: (n) => n.includes("Horas do Plano Contratado"), categoria: "Serviços de Espaço - Seaway Center" },
  { test: (n) => n.includes("Coworking Estação"), categoria: "Salas Privativas - Seaway Center" },
];

export const SEM_CATEGORIA = "Sem Categoria";

/** Trim + colapsa espaços duplos + lowercase — mesma normalização usada ao semear a tabela. */
export function normalizeName(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

export class CategoryMatcher {
  private readonly byExactName = new Map<string, string>();
  private readonly rulesByLengthDesc: CategoryRule[];

  constructor(rules: CategoryRule[]) {
    for (const r of rules) {
      this.byExactName.set(normalizeName(r.nome), r.categoria);
    }
    this.rulesByLengthDesc = [...rules].sort((a, b) => b.nome.length - a.nome.length);
  }

  match(nomeServico: string): CategorizationMatch {
    const nome = (nomeServico ?? "").trim();
    if (!nome) return { categoria: SEM_CATEGORIA, matchType: "sem_categoria" };

    const exact = this.byExactName.get(normalizeName(nome));
    if (exact) return { categoria: exact, matchType: "exato" };

    const semSufixo = nome.replace(SUFFIX_RE, "").trim();
    if (semSufixo !== nome) {
      const bySemSufixo = this.byExactName.get(normalizeName(semSufixo));
      if (bySemSufixo) return { categoria: bySemSufixo, matchType: "sufixo" };
    }

    const nomeNorm = normalizeName(nome);
    for (const rule of this.rulesByLengthDesc) {
      if (nomeNorm.startsWith(normalizeName(rule.nome))) {
        return { categoria: rule.categoria, matchType: "prefixo" };
      }
    }

    for (const fallback of FIXED_FALLBACKS) {
      if (fallback.test(nome)) return { categoria: fallback.categoria, matchType: "fallback" };
    }

    return { categoria: SEM_CATEGORIA, matchType: "sem_categoria" };
  }
}
