import type { ColunaDef, GrupoDef, Papel } from "./tipos";

/**
 * As colunas da exportação de RECEITA (ADR-0035). Puro.
 *
 * Cada linha é UM BUCKET de categoria dentro de uma fatura, por mês de crédito (ADR-0013/0029): "linhas" não é o
 * número de faturas, e uma fatura rateada aparece em várias linhas.
 *
 * ⚠ SÓ `Valor Recebido Cat.` SOMA. `Valor Recebido Total`, `Valor Bruto` e `Valor Desconto` são do CABEÇALHO da
 * fatura e se repetem em cada linha dela (categorize-invoices.ts) — somá-los conta o mesmo dinheiro mais de uma vez.
 * Os títulos dessas três colunas dizem isso, e a aba Leia-me repete.
 */

/** O que a consulta devolve, já em tipos simples: dinheiro como string decimal, datas como Date UTC. */
export interface LinhaReceita {
  id: string;
  crConexaId: number;
  chaveLinha: string;
  unidade: string | null;
  faturamento: string | null;
  clienteConexaId: number | null;
  cpfCnpj: string | null;
  razaoSocial: string | null;
  planoContratado: string | null;
  categoria: string;
  servicoOuPlano: string;
  proporcionado: string;
  tipo: string | null;
  status: string | null;
  parcela: string | null;
  valorRecebidoCat: string;
  valorRecebidoTotal: string;
  valorBruto: string | null;
  valorDesconto: string | null;
  vencimento: Date | null;
  quitacao: Date | null;
  competencia: Date | null;
  emissao: Date | null;
  dataCredito: Date | null;
  mesCredito: string;
  conta: string | null;
  observacoes: string | null;
  tags: string | null;
  ajusteArredondamento: string | null;
  revisadoManualmente: boolean;
  revisadoPorNome: string | null;
  /** Relógio de parede no fuso do app (o Excel não tem fuso). */
  revisadoEm: Date | null;
  categoriaOriginal: string | null;
  valorRecebidoCatOriginal: string | null;
  /** Relógio de parede no fuso do app. */
  atualizadoEm: Date;
  /** Só preenchido quando a exportação pede os itens (aba Itens). */
  itensDetalhe: unknown | null;
}

export const GRUPOS_RECEITA: GrupoDef[] = [
  {
    id: "essenciais",
    rotulo: "Essenciais",
    descricao: "Fatura, cliente, serviço/plano, categoria, valor, data e mês de crédito, conta, unidade e situação.",
    somenteAdmin: false,
    padrao: true,
    fixo: true,
  },
  {
    id: "fatura",
    rotulo: "Dados da fatura",
    descricao:
      "Tipo, parcela, faturamento, plano contratado, vencimento, quitação, competência, emissão, tags e os valores da fatura inteira (total, bruto, desconto).",
    somenteAdmin: false,
    padrao: true,
  },
  {
    id: "auditoria",
    rotulo: "Auditoria e revisão",
    descricao:
      "Proporcionado (N/S/Sem LV), revisão manual (quem, quando, categoria e valor originais), ajuste de arredondamento e identificadores internos.",
    somenteAdmin: false,
    padrao: false,
  },
  {
    id: "sensiveis",
    rotulo: "Dados pessoais e texto livre",
    descricao:
      "CPF/CNPJ e o campo Observações (texto livre digitado no Conexa, pode conter dados pessoais). Somente administrador.",
    somenteAdmin: true,
    padrao: false,
  },
];

const TIPO_FATURA = " — da fatura, NÃO somar";

/** Em ORDEM de exibição. A ordem do arquivo é esta, independentemente de quais grupos foram escolhidos. */
export const COLUNAS_RECEITA: ColunaDef<LinhaReceita>[] = [
  { id: "idFatura", titulo: "ID Fatura", grupo: "essenciais", tipo: "id", largura: 11, valor: (l) => l.crConexaId, campos: ["crConexaId"] },
  { id: "cliente", titulo: "Razão Social Cliente", grupo: "essenciais", tipo: "texto", largura: 38, valor: (l) => l.razaoSocial, campos: ["razaoSocial"] },
  { id: "cpfCnpj", titulo: "CPF/CNPJ", grupo: "sensiveis", tipo: "texto", largura: 20, valor: (l) => l.cpfCnpj, campos: ["cpfCnpj"] },
  { id: "servicoOuPlano", titulo: "Serviço/Plano", grupo: "essenciais", tipo: "texto", largura: 46, valor: (l) => l.servicoOuPlano, campos: ["servicoOuPlano"] },
  { id: "categoria", titulo: "Categoria", grupo: "essenciais", tipo: "texto", largura: 34, valor: (l) => l.categoria, campos: ["categoria"] },
  { id: "valorCat", titulo: "Valor Recebido Cat.", grupo: "essenciais", tipo: "dinheiro", largura: 20, valor: (l) => l.valorRecebidoCat, campos: ["valorRecebidoCat"] },
  { id: "dataCredito", titulo: "Data Crédito", grupo: "essenciais", tipo: "data", largura: 13, valor: (l) => l.dataCredito, campos: ["dataCredito"] },
  { id: "mesCredito", titulo: "Mês de Crédito", grupo: "essenciais", tipo: "texto", largura: 12, valor: (l) => l.mesCredito, campos: ["mesCredito"] },
  { id: "conta", titulo: "Conta", grupo: "essenciais", tipo: "texto", largura: 36, valor: (l) => l.conta, campos: ["conta"] },
  { id: "unidade", titulo: "Unidade", grupo: "essenciais", tipo: "texto", largura: 20, valor: (l) => l.unidade, campos: ["unidade"] },
  { id: "status", titulo: "Status", grupo: "essenciais", tipo: "texto", largura: 28, valor: (l) => l.status, campos: ["status"] },

  { id: "idCliente", titulo: "ID Cliente", grupo: "fatura", tipo: "id", largura: 11, valor: (l) => l.clienteConexaId, campos: ["clienteConexaId"] },
  { id: "faturamento", titulo: "Faturamento", grupo: "fatura", tipo: "texto", largura: 14, valor: (l) => l.faturamento, campos: ["faturamento"] },
  { id: "planoContratado", titulo: "Plano(s) Contratado(s)", grupo: "fatura", tipo: "texto", largura: 40, valor: (l) => l.planoContratado, campos: ["planoContratado"] },
  { id: "tipo", titulo: "Tipo", grupo: "fatura", tipo: "texto", largura: 14, valor: (l) => l.tipo, campos: ["tipo"] },
  { id: "parcela", titulo: "Parcela", grupo: "fatura", tipo: "texto", largura: 10, valor: (l) => l.parcela, campos: ["parcela"] },
  { id: "valorTotal", titulo: `Valor Recebido Total${TIPO_FATURA}`, grupo: "fatura", tipo: "dinheiro", largura: 22, valor: (l) => l.valorRecebidoTotal, campos: ["valorRecebidoTotal"] },
  { id: "valorBruto", titulo: `Valor Bruto${TIPO_FATURA}`, grupo: "fatura", tipo: "dinheiro", largura: 22, valor: (l) => l.valorBruto, campos: ["valorBruto"] },
  { id: "valorDesconto", titulo: `Valor Desconto${TIPO_FATURA}`, grupo: "fatura", tipo: "dinheiro", largura: 22, valor: (l) => l.valorDesconto, campos: ["valorDesconto"] },
  { id: "vencimento", titulo: "Vencimento", grupo: "fatura", tipo: "data", largura: 13, valor: (l) => l.vencimento, campos: ["vencimento"] },
  { id: "quitacao", titulo: "Quitação", grupo: "fatura", tipo: "data", largura: 13, valor: (l) => l.quitacao, campos: ["quitacao"] },
  { id: "competencia", titulo: "Competência", grupo: "fatura", tipo: "data", largura: 13, valor: (l) => l.competencia, campos: ["competencia"] },
  { id: "emissao", titulo: "Emissão", grupo: "fatura", tipo: "data", largura: 13, valor: (l) => l.emissao, campos: ["emissao"] },
  { id: "tags", titulo: "Tags", grupo: "fatura", tipo: "texto", largura: 24, valor: (l) => l.tags, campos: ["tags"] },

  { id: "proporcionado", titulo: "Proporcionado", grupo: "auditoria", tipo: "texto", largura: 14, valor: (l) => l.proporcionado, campos: ["proporcionado"] },
  { id: "revisada", titulo: "Revisada manualmente", grupo: "auditoria", tipo: "texto", largura: 14, valor: (l) => (l.revisadoManualmente ? "Sim" : "Não"), campos: ["revisadoManualmente"] },
  { id: "categoriaOriginal", titulo: "Categoria original (antes da revisão)", grupo: "auditoria", tipo: "texto", largura: 34, valor: (l) => l.categoriaOriginal, campos: ["categoriaOriginal"] },
  { id: "valorCatOriginal", titulo: "Valor Cat. original (antes da revisão)", grupo: "auditoria", tipo: "dinheiro", largura: 20, valor: (l) => l.valorRecebidoCatOriginal, campos: ["valorRecebidoCatOriginal"] },
  { id: "revisadaPor", titulo: "Revisada por", grupo: "auditoria", tipo: "texto", largura: 24, valor: (l) => l.revisadoPorNome, campos: ["revisadoPorNome"] },
  { id: "revisadaEm", titulo: "Revisada em", grupo: "auditoria", tipo: "datahora", largura: 17, valor: (l) => l.revisadoEm, campos: ["revisadoEm"] },
  { id: "ajuste", titulo: "Ajuste de arredondamento", grupo: "auditoria", tipo: "dinheiro", largura: 16, valor: (l) => l.ajusteArredondamento, campos: ["ajusteArredondamento"] },
  { id: "atualizadaEm", titulo: "Atualizada em", grupo: "auditoria", tipo: "datahora", largura: 17, valor: (l) => l.atualizadoEm, campos: ["atualizadoEm"] },
  { id: "idLinha", titulo: "ID interno da linha", grupo: "auditoria", tipo: "texto", largura: 28, valor: (l) => l.id, campos: ["id"] },

  { id: "observacoes", titulo: "Observações", grupo: "sensiveis", tipo: "texto", largura: 50, valor: (l) => l.observacoes, campos: ["observacoes"] },
];

/**
 * Campos que a exportação SEMPRE lê, haja a coluna que houver: os resumos, o rodapé, as conferências e a aba Leia-me
 * dependem deles (categoria, conta, unidade, situação, rateio, mês e data de crédito, fatura, valor e revisão).
 */
export const CAMPOS_BASE_RECEITA: readonly string[] = [
  "crConexaId",
  "categoria",
  "valorRecebidoCat",
  "conta",
  "unidade",
  "status",
  "proporcionado",
  "mesCredito",
  "dataCredito",
  "revisadoManualmente",
];

/** A união dos campos que as colunas escolhidas (mais a base) precisam — é só isto que o banco devolve. */
export function camposNecessarios(colunas: readonly ColunaDef<LinhaReceita>[], extras: readonly string[] = []): Set<string> {
  const campos = new Set<string>([...CAMPOS_BASE_RECEITA, ...extras]);
  for (const c of colunas) for (const f of c.campos) campos.add(f);
  return campos;
}

/** Id da coluna cuja soma é "o valor da exportação". */
export const COLUNA_VALOR_RECEITA = "valorCat";

/** Os ids de grupo que a pessoa pode marcar/desmarcar (os fixos ficam de fora). */
export const GRUPOS_OPCIONAIS_RECEITA = GRUPOS_RECEITA.filter((g) => !g.fixo).map((g) => g.id);

/** Grupos que vêm marcados quando o pedido não diz nada. */
export const GRUPOS_PADRAO_RECEITA = GRUPOS_RECEITA.filter((g) => g.padrao && !g.fixo).map((g) => g.id);

/** As colunas dos grupos escolhidos (mais os fixos), na ordem do catálogo. */
export function colunasDosGrupos(escolhidos: readonly string[]): ColunaDef<LinhaReceita>[] {
  const ativos = new Set<string>(["essenciais", ...escolhidos]);
  return COLUNAS_RECEITA.filter((c) => ativos.has(c.grupo));
}

/** O grupo `g` pode ser pedido por este papel? */
export function grupoPermitido(g: string, papel: Papel): boolean {
  const def = GRUPOS_RECEITA.find((x) => x.id === g);
  if (!def) return false;
  return !def.somenteAdmin || papel === "ADMIN";
}

/** Algum dos grupos escolhidos carrega dado pessoal? (vai para o log) */
export function temDadosPessoais(escolhidos: readonly string[]): boolean {
  return escolhidos.some((g) => GRUPOS_RECEITA.find((x) => x.id === g)?.somenteAdmin === true);
}
