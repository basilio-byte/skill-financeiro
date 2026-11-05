import { formatBRL, sum, toAmountString } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { validarParametros, lista, um, type ParamsBrutos } from "./parametros";
import { abaDeTabela, abaLeiaMe, type ColunaTabela } from "./planilha";
import type { UsuarioExport } from "./tipos";

/**
 * Exportação de METAS (ADR-0035) — a parte PURA: pedido, rótulos e montagem das abas.
 *
 * O "realizado" NÃO é recalculado aqui: vem de `buildMetas` (o mesmo código da tela Metas/Panorama e do MCP), uma
 * chamada por mês e por trimestre do ano. Por isso a planilha mostra exatamente o que o painel mostra.
 */

export type Granularidade = "MES" | "TRIMESTRE";

export interface PedidoMetas {
  ano: number;
  granularidades: Granularidade[];
  /** Slugs dos escopos; vazio = todos. */
  escopos: string[];
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-10" → "Outubro de 2026"; "2026-Q4" → "4º trimestre de 2026". */
export function rotuloPeriodoMeta(g: Granularidade, chave: string): string {
  const [ano, sub] = chave.split("-");
  if (g === "MES") {
    const m = MESES[Number(sub) - 1] ?? sub ?? "";
    return `${m.charAt(0).toUpperCase()}${m.slice(1)} de ${ano}`;
  }
  return `${(sub ?? "").replace("Q", "")}º trimestre de ${ano}`;
}

export function lerPedidoMetas(params: ParamsBrutos, anoAtual: number): { pedido: PedidoMetas; erros: string[] } {
  const erros: string[] = [];
  validarParametros(params, ["ano"], erros);
  let ano = anoAtual;
  const anoBruto = um(params.ano);
  if (anoBruto) {
    if (/^\d{4}$/.test(anoBruto) && Number(anoBruto) >= 2000 && Number(anoBruto) <= 2100) ano = Number(anoBruto);
    else erros.push(`Ano inválido ("${anoBruto.slice(0, 10)}"): use quatro dígitos, entre 2000 e 2100.`);
  }

  const pedidas = lista(params.tipo, 5, 20);
  const invalidas = pedidas.filter((t) => t !== "mensal" && t !== "trimestral");
  if (invalidas.length) erros.push(`Tipo de meta desconhecido: ${invalidas.map((t) => `"${t.slice(0, 20)}"`).join(", ")} (use mensal ou trimestral).`);
  let granularidades: Granularidade[] = [];
  if (pedidas.includes("mensal")) granularidades.push("MES");
  if (pedidas.includes("trimestral")) granularidades.push("TRIMESTRE");
  // Nenhuma escolhida (ou pedido sem formulário) = as duas: a tela mostra as duas juntas.
  if (granularidades.length === 0) granularidades = ["MES", "TRIMESTRE"];

  return { pedido: { ano, granularidades, escopos: lista(params.escopo, 30, 80) }, erros };
}

export function descreverPedidoMetas(p: PedidoMetas): Array<[string, string]> {
  return [
    ["Ano", String(p.ano)],
    ["Tipo de meta", p.granularidades.map((g) => (g === "MES" ? "mensal" : "trimestral")).join(" e ")],
    ["Escopos", p.escopos.length ? p.escopos.join("; ") : "todos os escopos ativos"],
  ];
}

export function nomeDoArquivoMetas(p: PedidoMetas, extensao = "xlsx"): string {
  return `Metas_${p.ano}.${extensao}`;
}

export interface LinhaMeta {
  granularidade: Granularidade;
  periodoChave: string;
  situacao: "encerrado" | "em andamento" | "futuro";
  escopoSlug: string;
  escopoNome: string;
  /** Escopo "todas as categorias": se sobrepõe aos demais. */
  abrangeTudo: boolean;
  /** É a linha de total dos escopos por categoria do período (sem o escopo que abrange tudo). */
  ehTotal: boolean;
  meta: string | null;
  realizado: string;
  /** Porcentagem (91.5 = 91,5%). */
  percentual: number | null;
  falta: string | null;
}

export interface EventoMeta {
  /** Relógio de parede (fuso do app). */
  quando: Date;
  granularidade: Granularidade;
  periodoChave: string;
  escopoNome: string;
  de: string | null;
  para: string;
  por: string | null;
}

export interface EscopoMeta {
  slug: string;
  nome: string;
  abrangeTudo: boolean;
  ativo: boolean;
  categorias: string[];
}

export interface EntradaPastaMetas {
  linhas: LinhaMeta[];
  eventos: EventoMeta[];
  escopos: EscopoMeta[];
  pedido: PedidoMetas;
  geradoEm: Date;
  usuario: UsuarioExport;
  frescor: { texto: string; alerta: boolean };
}

const COLUNAS_METAS: ColunaTabela[] = [
  { titulo: "Tipo", tipo: "texto", largura: 12 },
  { titulo: "Período", tipo: "texto", largura: 24 },
  { titulo: "Chave", tipo: "texto", largura: 10 },
  { titulo: "Situação do período", tipo: "texto", largura: 16 },
  { titulo: "Escopo", tipo: "texto", largura: 44 },
  { titulo: "Soma todas as categorias", tipo: "texto", largura: 14 },
  { titulo: "Meta", tipo: "dinheiro", largura: 16 },
  { titulo: "Realizado", tipo: "dinheiro", largura: 16 },
  { titulo: "% atingido", tipo: "percentual", largura: 12 },
  { titulo: "Falta para a meta", tipo: "dinheiro", largura: 16 },
];

export const NOME_TOTAL_ESCOPOS = "TOTAL dos escopos por categoria (sem sobreposição)";

export function montarAbasMetas(e: EntradaPastaMetas): { abas: Sheet[]; nLinhas: number } {
  const ordem = (l: LinhaMeta) => (l.granularidade === "MES" ? 0 : 1);
  const linhas = [...e.linhas].sort((a, b) => ordem(a) - ordem(b) || a.periodoChave.localeCompare(b.periodoChave));

  const metas = abaDeTabela({
    nome: "Metas e realizado",
    colunas: COLUNAS_METAS,
    linhas: linhas.map((l) => [
      l.granularidade === "MES" ? "Mensal" : "Trimestral",
      rotuloPeriodoMeta(l.granularidade, l.periodoChave),
      l.periodoChave,
      l.situacao,
      l.ehTotal ? NOME_TOTAL_ESCOPOS : l.escopoNome,
      l.ehTotal ? "—" : l.abrangeTudo ? "Sim" : "Não",
      l.meta,
      l.realizado,
      l.percentual === null ? null : l.percentual.toFixed(2),
      l.falta,
    ]),
    nota:
      "NÃO some as linhas desta aba: o escopo 'todas as categorias' contém a receita dos demais (somar contaria dinheiro duas vezes), " +
      "e mensal e trimestral são séries independentes — uma nunca é a soma da outra. Sem meta definida, o realizado mostra a receita do período mesmo assim.",
  });

  const historico = abaDeTabela({
    nome: "Histórico de alterações",
    colunas: [
      { titulo: "Quando", tipo: "datahora", largura: 17 },
      { titulo: "Tipo", tipo: "texto", largura: 12 },
      { titulo: "Período", tipo: "texto", largura: 24 },
      { titulo: "Escopo", tipo: "texto", largura: 44 },
      { titulo: "Valor anterior", tipo: "dinheiro", largura: 16 },
      { titulo: "Novo valor", tipo: "dinheiro", largura: 16 },
      { titulo: "Alterado por", tipo: "texto", largura: 28 },
    ],
    linhas: e.eventos.map((v) => [v.quando, v.granularidade === "MES" ? "Mensal" : "Trimestral", rotuloPeriodoMeta(v.granularidade, v.periodoChave), v.escopoNome, v.de, v.para, v.por]),
    nota: "Cada alteração de meta fica registrada (quem, quando, de quanto para quanto). Valor anterior em branco = criação da meta.",
  });

  const escopos = abaDeTabela({
    nome: "Escopos",
    colunas: [
      { titulo: "Escopo", tipo: "texto", largura: 44 },
      { titulo: "Identificador", tipo: "texto", largura: 28 },
      { titulo: "Soma todas as categorias", tipo: "texto", largura: 14 },
      { titulo: "Ativo", tipo: "texto", largura: 8 },
      { titulo: "Categorias que compõem o escopo", tipo: "texto", largura: 90 },
    ],
    linhas: e.escopos.map((s) => [s.nome, s.slug, s.abrangeTudo ? "Sim" : "Não", s.ativo ? "Sim" : "Não", s.abrangeTudo ? "(todas as categorias, inclusive as criadas depois)" : s.categorias.join("; ")]),
    nota: "As categorias aparecem com o espaçamento EXATO gravado nas linhas (a grafia com dois espaços de 'Sebrae' e 'Ayrton Senna' é real e não pode ser normalizada).",
  });

  const comMeta = linhas.filter((l) => !l.ehTotal && l.meta !== null).length;
  const leiaMe = abaLeiaMe({
    titulo: "Exportação de metas — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: `${e.usuario.nome} (${e.usuario.email})`,
    filtros: descreverPedidoMetas(e.pedido),
    resultado: [
      ["Linhas em 'Metas e realizado'", linhas.length.toLocaleString("pt-BR")],
      ["Linhas com meta definida", comMeta.toLocaleString("pt-BR")],
      ["Alterações de meta no ano", e.eventos.length.toLocaleString("pt-BR")],
      totalDoAno(linhas),
    ],
    frescor: e.frescor,
    avisos: [
      "O realizado vem do MESMO cálculo da tela Metas/Panorama (por Data de Crédito da Cobrança), feito ao vivo no momento da exportação; a meta é a que está cadastrada.",
      "Mensal e trimestral são séries independentes e o escopo 'todas as categorias' se sobrepõe aos demais: não some as linhas.",
      "Mês ou trimestre fechado e depois reprocessado é RECATEGORIZADO com as regras de hoje: o realizado por escopo pode diferir do que foi apresentado na época, embora o total do período seja o mesmo.",
    ],
    conferencia: "Esta exportação não tem total único a conferir (as linhas não são aditivas); a leitura de volta do arquivo confere o cabeçalho e o número de linhas antes de entregar.",
  });
  return { abas: [leiaMe, metas, historico, escopos], nLinhas: linhas.length };
}

/**
 * A linha "Receita total do ano" do Leia-me — só informativa. Soma os 12 meses do escopo "todas as categorias" quando o
 * recorte os traz; senão os 4 trimestres do mesmo escopo (os trimestres repartem o ano); senão NÃO apura: dizer "R$ 0,00"
 * de um ano com receita é pior que não dizer. Só UM escopo "todas as categorias" entra (dois somariam o ano em dobro).
 */
export function totalDoAno(linhas: LinhaMeta[]): [string, string] {
  const rotulo = "Receita total do ano (escopo 'todas as categorias')";
  const globais = linhas.filter((l) => l.abrangeTudo && !l.ehTotal);
  const escopo = globais[0]?.escopoSlug;
  const doEscopo = globais.filter((l) => l.escopoSlug === escopo);
  const meses = doEscopo.filter((l) => l.granularidade === "MES");
  if (meses.length === 12) return [`${rotulo}, soma dos meses`, formatBRL(toAmountString(sum(meses.map((l) => l.realizado))))];
  const trimestres = doEscopo.filter((l) => l.granularidade === "TRIMESTRE");
  if (trimestres.length === 4) return [`${rotulo}, soma dos trimestres`, formatBRL(toAmountString(sum(trimestres.map((l) => l.realizado))))];
  return [rotulo, "não apurada neste recorte (peça o escopo 'todas as categorias' com os 12 meses ou os 4 trimestres)"];
}
