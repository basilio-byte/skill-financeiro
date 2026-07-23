/**
 * Motor de categorização — PORTA EXATA de categoriza_receita.py (skill
 * OpenClaw), comparada linha a linha contra o script real em 2026-07-23 (ver
 * docs/context/decisions.md, ADR-0018). Ordem de prioridade:
 *
 *  1. Correspondência exata do nome do serviço/plano na tabela de categorias.
 *  2. Correspondência exata ignorando sufixo "(Mensal|Anual|Bianual)? (SEAHUB COWORKING|SEATECH)".
 *  3. Maior prefixo cadastrado que combina com o nome (sem sufixo).
 *  4. Fallbacks fixos (unidades/pacotes conhecidos sem entrada na tabela).
 *  5. "Sem Categoria".
 *
 * Deliberadamente CASE-SENSITIVE e SEM colapso de espaços internos — o script
 * real só faz `str(x).strip()` (Python), nunca lowercase nem normalização de
 * espaço duplo. A Duda validou o resultado exatamente como esse comportamento
 * produz (inclusive as inconsistências de grafia da própria tabela dela, como
 * o espaço duplo em "Serviços de Espaço -  Sebrae") — "corrigir" isso aqui
 * silenciosamente produziria categorização DIFERENTE da que ela aprovou.
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

/**
 * Replica `_SUFIXOS` do Python EXATAMENTE:
 *   r"\s*(Mensal|Anual|Bianual)?\s*\((SEAHUB COWORKING|SEATECH)\)$"
 * O grupo de periodicidade é OPCIONAL ("?") — repare que uma versão anterior
 * desta regra em TS exigia a palavra Mensal/Anual/Bianual, o que fazia o
 * script real remover sufixos como "(SEAHUB COWORKING)" puro (sem
 * periodicidade) que nós não removíamos. Sem "\s*" à direita porque o Python
 * já roda `.strip()` antes de aplicar o regex (ver normServico).
 */
const SUFFIX_RE = /\s*(Mensal|Anual|Bianual)?\s*\((SEAHUB COWORKING|SEATECH)\)$/i;

/**
 * Replica `_FALLBACK_PREFIXOS` do Python literalmente — inclusive o espaço
 * duplo em "Serviços de Espaço -  Sebrae"/"-  Ayrton Senna", que é o valor
 * REAL gravado por Duda na tabela de categorias para essas duas unidades
 * (confirmado: toda linha da tabela real que mapeia para essas categorias usa
 * espaço duplo, de forma 100% consistente — não é ruído, é a convenção dela).
 */
const FIXED_FALLBACKS: Array<{ prefixo: string; categoria: string }> = [
  { prefixo: "[SEAWAY] -", categoria: "Serviços de Espaço - Seaway Center" },
  { prefixo: "[AYRTON SENNA] -", categoria: "Serviços de Espaço -  Ayrton Senna" },
  { prefixo: "[SEBRAE] -", categoria: "Serviços de Espaço -  Sebrae" },
  { prefixo: "Horas do Plano Contratado", categoria: "Serviços de Espaço - Seaway Center" },
  { prefixo: "Coworking Estação", categoria: "Salas Privativas - Seaway Center" },
];

export const SEM_CATEGORIA = "Sem Categoria";

/**
 * Replica `norm_servico(s)` do Python: strip + remove sufixo + strip de novo.
 * NENHUM colapso de espaço interno, NENHUM lowercase.
 */
export function normServico(s: string): string {
  if (!s) return "";
  const trimmed = s.trim();
  return trimmed.replace(SUFFIX_RE, "").trim();
}

export class CategoryMatcher {
  /**
   * Mantém a ORDEM DE CHEGADA das regras (equivalente à ordem de inserção do
   * dict Python, que por sua vez é a ordem das linhas na planilha de
   * categorias) — usada pelo desempate de "maior prefixo" abaixo. Nunca
   * reordenamos por tamanho: o próprio algoritmo de busca já resolve isso
   * incrementalmente, do mesmo jeito que `_prefix_match` faz em Python.
   */
  private readonly rules: CategoryRule[];

  /**
   * Lookup exato: chave é `nome.trim()` — SEM colapsar espaço, SEM lowercase.
   * Replica `lookup[str(nome).strip()] = str(cat).strip()`. Duplicatas
   * exatas: a ÚLTIMA linha vence (mesmo comportamento de um dict Python
   * populado em loop).
   */
  private readonly byExactName = new Map<string, string>();

  constructor(rules: CategoryRule[]) {
    this.rules = rules;
    for (const r of rules) {
      this.byExactName.set(r.nome.trim(), r.categoria.trim());
    }
  }

  /**
   * Replica `_prefix_match(s, cat_lookup)`: percorre TODAS as regras, mantém
   * a de MAIOR comprimento cujo nome é prefixo de `s` — em empate de
   * comprimento, o Python usa comparação ESTRITA (`>`), então o PRIMEIRO
   * visto vence e nunca é substituído por um empate posterior. Iterar na
   * ordem de chegada (não reordenada) e nunca substituir em `===` replica
   * isso exatamente, independente de garantia de ordem do array de entrada.
   */
  private prefixMatch(s: string): string | null {
    let bestKey = "";
    let bestCat: string | null = null;
    for (const r of this.rules) {
      const key = r.nome.trim();
      if (key.length > bestKey.length && s.startsWith(key)) {
        bestKey = key;
        bestCat = r.categoria.trim();
      }
    }
    return bestCat;
  }

  match(nomeServico: string): CategorizationMatch {
    const servico = (nomeServico ?? "").trim();
    if (!servico) return { categoria: SEM_CATEGORIA, matchType: "sem_categoria" };

    const norm = normServico(servico);

    // 1. Exato, com sufixo original se houver (case-sensitive, só trim).
    let cat = this.byExactName.get(servico) ?? null;
    if (cat) return { categoria: cat, matchType: "exato" };

    // 2. Exato sem sufixo.
    cat = this.byExactName.get(norm) ?? null;
    if (cat) return { categoria: cat, matchType: "sufixo" };

    // 3. Maior prefixo cadastrado, sobre a versão SEM sufixo.
    cat = this.prefixMatch(norm);
    if (cat) return { categoria: cat, matchType: "prefixo" };

    // 4. Fallbacks fixos — testa a versão sem sufixo E a original, replicando
    // `norm.startswith(prefixo) or servico.startswith(prefixo)`.
    for (const fb of FIXED_FALLBACKS) {
      if (norm.startsWith(fb.prefixo) || servico.startsWith(fb.prefixo)) {
        return { categoria: fb.categoria, matchType: "fallback" };
      }
    }

    return { categoria: SEM_CATEGORIA, matchType: "sem_categoria" };
  }
}
