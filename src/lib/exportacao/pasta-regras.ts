import { formatBRL, sum, toAmountString, ZERO } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { validarParametros, lerSimNao, lista, um, type ParamsBrutos } from "./parametros";
import { abaDeTabela, abaLeiaMe } from "./planilha";
import type { UsuarioExport } from "./tipos";

/**
 * Exportação das REGRAS DE CATEGORIA (ADR-0035) — a parte PURA: pedido e montagem das abas.
 *
 * A tabela de regras é o que mapeia o NOME EXATO de um serviço/plano para uma categoria (ver categorization/rules.ts).
 * Os nomes saem com o espaçamento exato do banco: "Salas Privativas -  Sebrae" (dois espaços) é uma grafia real,
 * distinta de "Salas Privativas - Sebrae", e normalizar mudaria o que a regra casa. A aba "Sem categoria" lista os
 * nomes que ainda não têm regra (o que falta cadastrar), com quanto dinheiro cada um representa.
 */

export type FiltroAtivo = "todas" | "ativas" | "inativas";

export interface PedidoRegras {
  categorias: string[];
  ativo: FiltroAtivo;
  /** Trecho do nome (sem diferenciar maiúsculas). */
  busca: string | null;
  /** Incluir a aba "Sem categoria". */
  pendencias: boolean;
  /** Incluir a aba de resumo "Por categoria". */
  resumos: boolean;
}

export function lerPedidoRegras(params: ParamsBrutos): { pedido: PedidoRegras; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f", "ativo", "busca", "pendencias", "resumos"], erros);
  const ativoBruto = um(params.ativo) || "todas";
  let ativo: FiltroAtivo = "todas";
  if (ativoBruto === "todas" || ativoBruto === "ativas" || ativoBruto === "inativas") ativo = ativoBruto;
  else erros.push(`Situação da regra desconhecida ("${ativoBruto.slice(0, 20)}"): use todas, ativas ou inativas.`);
  const buscaBruta = um(params.busca).slice(0, 100);
  let busca: string | null = null;
  if (buscaBruta) {
    if (buscaBruta.length >= 2) busca = buscaBruta;
    else erros.push("Busca: digite ao menos 2 caracteres.");
  }
  const pendencias = lerSimNao(params, "pendencias", "Aba Sem categoria", false, enviado, erros);
  const resumos = lerSimNao(params, "resumos", "Aba Por categoria", false, enviado, erros);
  return { pedido: { categorias: lista(params.categoria), ativo, busca, pendencias, resumos }, erros };
}

export function descreverPedidoRegras(p: PedidoRegras): Array<[string, string]> {
  const out: Array<[string, string]> = [["Situação das regras", p.ativo === "todas" ? "todas (ativas e inativas)" : p.ativo]];
  if (p.categorias.length) out.push(["Categoria", p.categorias.join("; ")]);
  if (p.busca) out.push(["Nome contém", p.busca]);
  if (out.length === 1) out.push(["Outros filtros", "nenhum"]);
  return out;
}

export function nomeDoArquivoRegras(hojeIso: string, extensao = "xlsx"): string {
  return `Regras_de_categoria_${hojeIso}.${extensao}`;
}

export interface LinhaRegra {
  nome: string;
  categoria: string;
  ativo: boolean;
  /** Relógio de parede (fuso do app). */
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface Pendencia {
  nome: string;
  linhas: number;
  /** "1234.56" */
  valor: string;
  primeiroCredito: Date | null;
  ultimoCredito: Date | null;
}

export interface EntradaPastaRegras {
  regras: LinhaRegra[];
  pendencias: Pendencia[];
  pedido: PedidoRegras;
  geradoEm: Date;
  usuario: UsuarioExport;
}

export function montarAbasRegras(e: EntradaPastaRegras): { abas: Sheet[]; nLinhas: number } {
  const regras = [...e.regras].sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
  const abas: Sheet[] = [];

  abas.push(
    abaDeTabela({
      nome: "Regras",
      colunas: [
        { titulo: "Nome (Serviço/Item ou Plano Contratado)", tipo: "texto", largura: 70 },
        { titulo: "Categoria", tipo: "texto", largura: 40 },
        { titulo: "Ativa", tipo: "texto", largura: 8 },
        { titulo: "Criada em", tipo: "datahora", largura: 17 },
        { titulo: "Atualizada em", tipo: "datahora", largura: 17 },
      ],
      linhas: regras.map((r) => [r.nome, r.categoria, r.ativo ? "Sim" : "Não", r.criadoEm, r.atualizadoEm]),
      nota: "O nome tem de bater EXATAMENTE com o 'Serviço/Item' (Listar Vendas) ou o 'Plano Contratado' (Contas a Receber) do Conexa, espaços duplos inclusive.",
    }),
  );

  const porCategoria = new Map<string, { ativas: number; inativas: number }>();
  for (const r of regras) {
    const c = porCategoria.get(r.categoria) ?? { ativas: 0, inativas: 0 };
    if (r.ativo) c.ativas += 1;
    else c.inativas += 1;
    porCategoria.set(r.categoria, c);
  }
  const cats = [...porCategoria.entries()].sort((a, b) => b[1].ativas + b[1].inativas - (a[1].ativas + a[1].inativas) || a[0].localeCompare(b[0], "pt-BR"));
  // O resumo por categoria só vem se pedido: o painel já resume, a planilha é para os dados.
  if (e.pedido.resumos) {
    abas.push(
      abaDeTabela({
        nome: "Por categoria",
        colunas: [
          { titulo: "Categoria", tipo: "texto", largura: 44 },
          { titulo: "Regras ativas", tipo: "inteiro", largura: 14 },
          { titulo: "Regras inativas", tipo: "inteiro", largura: 14 },
          { titulo: "Total", tipo: "inteiro", largura: 10 },
        ],
        linhas: cats.map(([c, n]) => [c, n.ativas, n.inativas, n.ativas + n.inativas]),
        total: ["TOTAL", regras.filter((r) => r.ativo).length, regras.filter((r) => !r.ativo).length, regras.length],
        autoFiltro: false,
      }),
    );
  }

  let totalPendente = ZERO;
  if (e.pedido.pendencias) {
    totalPendente = sum(e.pendencias.map((p) => p.valor));
    abas.push(
      abaDeTabela({
        nome: "Sem categoria",
        colunas: [
          { titulo: "Serviço/Plano com linhas em Sem Categoria", tipo: "texto", largura: 70 },
          { titulo: "Linhas", tipo: "inteiro", largura: 10 },
          { titulo: "Valor Recebido Cat.", tipo: "dinheiro", largura: 20 },
          { titulo: "Primeiro crédito", tipo: "data", largura: 14 },
          { titulo: "Último crédito", tipo: "data", largura: 14 },
        ],
        linhas: e.pendencias.map((p) => [p.nome, p.linhas, p.valor, p.primeiroCredito, p.ultimoCredito]),
        total: ["TOTAL", e.pendencias.reduce((a, p) => a + p.linhas, 0), toAmountString(totalPendente), null, null],
        nota: "Nomes de serviço/plano com linhas em 'Sem Categoria' (em qualquer mês). Se o nome ainda NÃO tem regra, cadastre-a em Categorias; se já tem (veja a aba Regras), as linhas antigas só mudam ao reprocessar o mês. Cadastrar a regra resolve as próximas sincronizações.",
      }),
    );
  }

  const leiaMe = abaLeiaMe({
    titulo: "Exportação das regras de categoria — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: `${e.usuario.nome} (${e.usuario.email})`,
    filtros: descreverPedidoRegras(e.pedido),
    resultado: [
      ["Regras exportadas", regras.length.toLocaleString("pt-BR")],
      ["Ativas", regras.filter((r) => r.ativo).length.toLocaleString("pt-BR")],
      ["Categorias distintas", cats.length.toLocaleString("pt-BR")],
      ...(e.pedido.pendencias ? ([["Serviços/planos com linhas em Sem Categoria", `${e.pendencias.length.toLocaleString("pt-BR")} (${formatBRL(totalPendente)})`]] as Array<[string, string]>) : []),
    ],
    frescor: { texto: "Tabela lida do banco no momento da exportação.", alerta: false },
    avisos: [
      "Os nomes e categorias saem com o espaçamento EXATO do banco; as grafias com dois espaços ('Sebrae', 'Ayrton Senna') são reais e distintas das de um espaço.",
      "Só as regras ATIVAS entram na categorização; uma regra inativa fica registrada mas não casa nada.",
    ],
    conferencia: "Esta exportação não tem total único a conferir; a leitura de volta do arquivo confere o cabeçalho e o número de linhas antes de entregar.",
  });
  return { abas: [...abas, leiaMe], nLinhas: regras.length };
}
