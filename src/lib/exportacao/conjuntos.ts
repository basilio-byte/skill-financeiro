import type { Formato, Papel } from "./tipos";

/**
 * Os CONJUNTOS de dados que a central de exportação oferece (ADR-0035). Metadados puros: o que aparece nas abas da
 * tela, quem pode pedir e em que formato. Quem GERA cada um é `executar.ts`.
 */

export interface ConjuntoDef {
  id: string;
  titulo: string;
  descricao: string;
  /** Conjunto inteiro restrito a administradores (a rota recusa com 403 mesmo que o link seja digitado à mão). */
  somenteAdmin: boolean;
  formatos: Formato[];
}

export const CONJUNTOS: ConjuntoDef[] = [
  {
    id: "receita",
    titulo: "Receita",
    descricao: "Cobranças recebidas, por categoria — por Data de Crédito, o mesmo critério do Panorama.",
    somenteAdmin: false,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "inadimplencia",
    titulo: "Inadimplentes",
    descricao: "Cobranças vencidas e não pagas, por cobrança e por cliente, com os mesmos filtros da tela Inadimplentes.",
    somenteAdmin: false,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "metas",
    titulo: "Metas",
    descricao: "Meta × realizado por escopo, mensal e trimestral, com o histórico de alterações das metas.",
    somenteAdmin: false,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "regras",
    titulo: "Regras de categoria",
    descricao: "A tabela que mapeia serviço/plano → categoria, e o que ainda está sem categoria.",
    somenteAdmin: false,
    formatos: ["xlsx", "csv"],
  },
  // --- F3 -------------------------------------------------------------------------------------------------------
  {
    id: "conflitos",
    titulo: "Conflitos",
    descricao: "Faturas com possível dupla contagem (a mesma lista da tela Conflitos), com o que cada classificação significa. Só administradores.",
    somenteAdmin: true,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "sincronizacoes",
    titulo: "Sincronizações",
    descricao: "O histórico das rodadas de sincronização de receita: origem, status, contagens de linhas e conferência.",
    somenteAdmin: false,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "clickup",
    titulo: "ClickUp",
    descricao: "O espelho da receita no ClickUp: vínculos, composição (quais faturas somam o valor de cada tarefa) e envios de um mês. Só administradores.",
    somenteAdmin: true,
    formatos: ["xlsx", "csv"],
  },
  {
    id: "acessos",
    titulo: "Contas e acessos",
    descricao: "Contas, logins, auditoria do MCP, tokens (nunca o segredo) e o registro das exportações. Só administradores.",
    somenteAdmin: true,
    formatos: ["xlsx", "csv"],
  },
];

export function acharConjunto(id: string): ConjuntoDef | undefined {
  return CONJUNTOS.find((c) => c.id === id);
}

/** Os conjuntos que este papel vê (o administrador vê todos). */
export function conjuntosDoPapel(papel: Papel): ConjuntoDef[] {
  return CONJUNTOS.filter((c) => !c.somenteAdmin || papel === "ADMIN");
}
