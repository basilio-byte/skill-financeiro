import type { Prisma } from "@prisma/client";
import { formatBRL, money } from "@/lib/money";
import { GRUPOS_OPCIONAIS_RECEITA, GRUPOS_PADRAO_RECEITA } from "./colunas-receita";
import { DECIMAL, dataBr, dataReal, escaparLike, validarParametros, lerSimNao, lista, mesReal, paraData, um, type ParamsBrutos } from "./parametros";

/**
 * Filtros da exportação de RECEITA — da URL para a consulta (ADR-0035). PURO: sem banco, sem relógio implícito.
 *
 * O recorte de datas é SEMPRE por Data de Crédito da Cobrança, o mesmo critério do Panorama (decisão do usuário,
 * 2026-11-04): o total de um mês exportado é o mesmo número do Panorama daquele mês. Competência, vencimento e
 * quitação aparecem como COLUNAS, nunca como filtro.
 *
 * Diferença deliberada em relação a `filtros-revisao.ts` e `inadimplencia/dominio.ts`: lá valor malformado é
 * ignorado ("a tela mostra tudo"). Numa EXPORTAÇÃO isso seria perigoso — uma data digitada errada entregaria o banco
 * inteiro como se fosse o recorte pedido. Aqui valor malformado vira ERRO explícito, e a aba Leia-me do arquivo lista
 * os filtros que realmente valeram.
 */

export type { ParamsBrutos } from "./parametros";
export { dataBr, dataReal, mesReal } from "./parametros";

export const PROPORCIONADOS = ["N", "S", "SEM_LV"] as const;
export type ProporcionadoFiltro = (typeof PROPORCIONADOS)[number];

export const ROTULO_PROPORCIONADO: Record<ProporcionadoFiltro, string> = {
  N: "Categoria única (N)",
  S: "Rateada entre categorias (S)",
  SEM_LV: "Sem item no Listar Vendas (SEM_LV)",
};

/** Valor das listas de conta/unidade que significa "sem conta"/"sem unidade" (campo vazio). */
export const VAZIO = "~vazio";

export interface FiltrosReceita {
  /** "yyyy-MM" — atalho para o mês inteiro. Ignorado quando `de`/`ate` vêm preenchidos. */
  mes: string | null;
  /** "yyyy-MM-dd" inclusive. */
  de: string | null;
  ate: string | null;
  categorias: string[];
  contas: string[];
  unidades: string[];
  proporcionados: ProporcionadoFiltro[];
  status: string[];
  revisada: "sim" | "nao" | null;
  cliente: string | null;
  servico: string | null;
  fatura: number | null;
  /** Decimal com ponto ("1234.56"). */
  valorMin: string | null;
  valorMax: string | null;
  /** Ignorar linhas de valor R$ 0,00 (como a fila do Revisar: no rateio elas só registram que a categoria apareceu). */
  semZeradas: boolean;
  /** Grupos de colunas escolhidos, além dos fixos. */
  grupos: string[];
  /** Incluir as abas de resumo (por categoria, conta, unidade, mês…). */
  resumos: boolean;
  /** Incluir a aba Itens (itens do Listar Vendas e o valor rateado de cada um). */
  itens: boolean;
}

export interface ResultadoLeitura {
  filtros: FiltrosReceita;
  erros: string[];
}

/** O período que realmente vale: datas explícitas, ou o mês inteiro, ou nenhum (todos os meses). */
export function periodoEfetivo(f: Pick<FiltrosReceita, "mes" | "de" | "ate">): { de: string | null; ate: string | null } {
  if (f.de || f.ate) return { de: f.de, ate: f.ate };
  if (f.mes) {
    const [a, m] = f.mes.split("-").map(Number) as [number, number];
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return { de: `${f.mes}-01`, ate: `${f.mes}-${String(ultimo).padStart(2, "0")}` };
  }
  return { de: null, ate: null };
}


/**
 * Lê e VALIDA os parâmetros. `f=1` marca que o formulário foi enviado: com ele, a ausência de uma caixa de seleção
 * significa "desmarcada"; sem ele (link direto, chamada programática), valem os padrões — MENOS o que foi pedido de forma
 * explícita (`grupos`, `resumos=0|1`, `itens=0|1`), que vale sempre: ignorá-lo em silêncio entregaria um arquivo sem as
 * colunas pedidas (ou, num grupo de dado pessoal, sem o 403 que a pessoa mereceria).
 */
export function lerFiltrosReceita(params: ParamsBrutos): ResultadoLeitura {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f", "mes", "de", "ate", "revisada", "cliente", "servico", "fatura", "valorMin", "valorMax", "semZeradas", "resumos", "itens"], erros);

  let mes: string | null = null;
  const mesBruto = um(params.mes);
  if (mesBruto) {
    if (mesReal(mesBruto)) mes = mesBruto;
    else erros.push(`Mês inválido ("${mesBruto.slice(0, 20)}"): use o formato aaaa-mm, por exemplo 2026-10.`);
  }

  const lerData = (nome: string, rotulo: string): string | null => {
    const v = um(params[nome]);
    if (!v) return null;
    if (dataReal(v)) return v;
    erros.push(`${rotulo} inválida ("${v.slice(0, 20)}"): use uma data existente no formato aaaa-mm-dd.`);
    return null;
  };
  const de = lerData("de", "Data inicial");
  const ate = lerData("ate", "Data final");
  if (de && ate && de > ate) erros.push("A data inicial é depois da data final.");

  const proporcionados: ProporcionadoFiltro[] = [];
  for (const p of lista(params.proporcionado)) {
    if ((PROPORCIONADOS as readonly string[]).includes(p)) proporcionados.push(p as ProporcionadoFiltro);
    else erros.push(`Tipo de rateio desconhecido: "${p.slice(0, 20)}" (use N, S ou SEM_LV).`);
  }

  const revBruto = um(params.revisada);
  let revisada: "sim" | "nao" | null = null;
  if (revBruto === "sim" || revBruto === "nao") revisada = revBruto;
  else if (revBruto !== "") erros.push(`Revisão manual: valor desconhecido ("${revBruto.slice(0, 20)}"); use sim ou nao.`);

  const clienteBruto = um(params.cliente).slice(0, 100);
  let cliente: string | null = null;
  if (clienteBruto) {
    if (clienteBruto.length >= 2) cliente = clienteBruto;
    else erros.push("Cliente: digite ao menos 2 caracteres.");
  }
  const servicoBruto = um(params.servico).slice(0, 100);
  let servico: string | null = null;
  if (servicoBruto) {
    if (servicoBruto.length >= 2) servico = servicoBruto;
    else erros.push("Serviço/plano: digite ao menos 2 caracteres.");
  }

  let fatura: number | null = null;
  const faturaBruta = um(params.fatura);
  if (faturaBruta) {
    if (/^\d{1,10}$/.test(faturaBruta) && Number(faturaBruta) <= 2_147_483_647) fatura = Number(faturaBruta);
    else erros.push(`ID da fatura inválido ("${faturaBruta.slice(0, 20)}"): use só números.`);
  }

  const lerValor = (nome: string, rotulo: string): string | null => {
    const v = um(params[nome]);
    if (!v) return null;
    if (DECIMAL.test(v)) return v;
    erros.push(`${rotulo} inválido ("${v.slice(0, 20)}"): use número com PONTO decimal e até 2 casas, sem "R$" nem milhar (ex.: 1234.56).`);
    return null;
  };
  const valorMin = lerValor("valorMin", "Valor mínimo");
  const valorMax = lerValor("valorMax", "Valor máximo");
  if (valorMin && valorMax && money(valorMin).greaterThan(money(valorMax))) erros.push("O valor mínimo é maior que o valor máximo.");

  // "essenciais" é fixo (sempre presente): pedi-lo é inofensivo, não é erro.
  const gruposBrutos = lista(params.grupos, 20, 40);
  const gruposPedidos = gruposBrutos.filter((g) => g !== "essenciais");
  const gruposInvalidos = gruposPedidos.filter((g) => !GRUPOS_OPCIONAIS_RECEITA.includes(g));
  if (gruposInvalidos.length) erros.push(`Grupo de colunas desconhecido: ${gruposInvalidos.map((g) => `"${g.slice(0, 20)}"`).join(", ")}.`);
  // Grupo pedido de forma explícita vale com ou sem `f=1`; sem pedido nenhum e sem formulário, os padrões.
  const grupos = enviado || gruposBrutos.length > 0 ? gruposPedidos.filter((g) => GRUPOS_OPCIONAIS_RECEITA.includes(g)) : [...GRUPOS_PADRAO_RECEITA];
  const semZeradas = lerSimNao(params, "semZeradas", "Ignorar linhas de valor zero", false, enviado, erros);
  const resumos = lerSimNao(params, "resumos", "Abas de resumo", true, enviado, erros);
  const itens = lerSimNao(params, "itens", "Aba Itens", false, enviado, erros);

  return {
    erros,
    filtros: {
      mes,
      de,
      ate,
      categorias: lista(params.categoria),
      contas: lista(params.conta),
      unidades: lista(params.unidade),
      proporcionados,
      status: lista(params.status),
      revisada,
      cliente,
      servico,
      fatura,
      valorMin,
      valorMax,
      semZeradas,
      grupos,
      resumos,
      itens,
    },
  };
}

function listaOuVazio(campo: "conta" | "unidade", valores: string[]): Prisma.RevenueCategorizedLineWhereInput | null {
  if (!valores.length) return null;
  const textos = valores.filter((v) => v !== VAZIO);
  const or: Prisma.RevenueCategorizedLineWhereInput[] = [];
  if (textos.length) or.push(campo === "conta" ? { conta: { in: textos } } : { unidade: { in: textos } });
  if (valores.includes(VAZIO)) or.push(campo === "conta" ? { conta: null } : { unidade: null });
  return or.length === 1 ? or[0]! : { OR: or };
}

/** Os filtros como condição do banco. Sem nenhum filtro devolve `{}` (todas as linhas). */
export function filtrosParaWhere(f: FiltrosReceita): Prisma.RevenueCategorizedLineWhereInput {
  const and: Prisma.RevenueCategorizedLineWhereInput[] = [];

  const { de, ate } = periodoEfetivo(f);
  if (de || ate) and.push({ dataCredito: { ...(de ? { gte: paraData(de) } : {}), ...(ate ? { lte: paraData(ate) } : {}) } });

  if (f.categorias.length) and.push({ categoria: { in: f.categorias } });
  const conta = listaOuVazio("conta", f.contas);
  if (conta) and.push(conta);
  const unidade = listaOuVazio("unidade", f.unidades);
  if (unidade) and.push(unidade);
  if (f.proporcionados.length) and.push({ proporcionado: { in: f.proporcionados } });
  if (f.status.length) and.push({ status: { in: f.status } });
  if (f.revisada) and.push({ revisadoManualmente: f.revisada === "sim" });

  if (f.cliente) {
    const ou: Prisma.RevenueCategorizedLineWhereInput[] = [{ razaoSocial: { contains: escaparLike(f.cliente), mode: "insensitive" } }];
    // Só dígitos: pode ser o ID do cliente. NUNCA busca em CPF/CNPJ — quem não vê a coluna usaria a busca como oráculo.
    if (/^\d{1,10}$/.test(f.cliente) && Number(f.cliente) <= 2_147_483_647) ou.push({ clienteConexaId: Number(f.cliente) });
    and.push({ OR: ou });
  }
  if (f.servico) and.push({ servicoOuPlano: { contains: escaparLike(f.servico), mode: "insensitive" } });
  if (f.fatura !== null) and.push({ crConexaId: f.fatura });
  if (f.valorMin !== null || f.valorMax !== null) {
    and.push({ valorRecebidoCat: { ...(f.valorMin !== null ? { gte: f.valorMin } : {}), ...(f.valorMax !== null ? { lte: f.valorMax } : {}) } });
  }
  if (f.semZeradas) and.push({ valorRecebidoCat: { not: 0 } });
  return and.length ? { AND: and } : {};
}

const rotuloVazio = (campo: "conta" | "unidade") => (campo === "conta" ? "(sem conta informada)" : "(sem unidade)");

/** Os filtros em português, para a aba Leia-me e o log. Sempre começa pelo período. */
export function descreverFiltros(f: FiltrosReceita): Array<[string, string]> {
  const saida: Array<[string, string]> = [];
  const { de, ate } = periodoEfetivo(f);
  let periodo: string;
  if (de && ate) periodo = `${dataBr(de)} a ${dataBr(ate)}`;
  else if (de) periodo = `a partir de ${dataBr(de)}`;
  else if (ate) periodo = `até ${dataBr(ate)}`;
  else periodo = "todos os meses (sem filtro de data)";
  saida.push(["Período (Data de Crédito)", periodo]);

  const juntar = (valores: string[], campo?: "conta" | "unidade") =>
    valores.map((v) => (v === VAZIO && campo ? rotuloVazio(campo) : v)).join("; ");
  if (f.unidades.length) saida.push(["Unidade", juntar(f.unidades, "unidade")]);
  if (f.contas.length) saida.push(["Conta", juntar(f.contas, "conta")]);
  if (f.categorias.length) saida.push(["Categoria", juntar(f.categorias)]);
  if (f.proporcionados.length) saida.push(["Rateio (Proporcionado)", f.proporcionados.map((p) => ROTULO_PROPORCIONADO[p]).join("; ")]);
  if (f.status.length) saida.push(["Situação da cobrança", juntar(f.status)]);
  if (f.revisada) saida.push(["Revisão manual", f.revisada === "sim" ? "somente linhas revisadas manualmente" : "somente linhas NÃO revisadas"]);
  if (f.cliente) saida.push(["Cliente contém (texto exato)", f.cliente]);
  if (f.servico) saida.push(["Serviço/plano contém (texto exato)", f.servico]);
  if (f.fatura !== null) saida.push(["Fatura", String(f.fatura)]);
  if (f.valorMin !== null) saida.push(["Valor Cat. mínimo", formatBRL(f.valorMin)]);
  if (f.valorMax !== null) saida.push(["Valor Cat. máximo", formatBRL(f.valorMax)]);
  if (f.semZeradas) saida.push(["Linhas de valor R$ 0,00", "ignoradas (como a fila do Revisar)"]);
  if (saida.length === 1) saida.push(["Outros filtros", "nenhum"]);
  return saida;
}

/** Há algum filtro além do período? */
export function temFiltroAlemDoPeriodo(f: FiltrosReceita): boolean {
  return (
    f.categorias.length > 0 ||
    f.contas.length > 0 ||
    f.unidades.length > 0 ||
    f.proporcionados.length > 0 ||
    f.status.length > 0 ||
    f.revisada !== null ||
    f.cliente !== null ||
    f.servico !== null ||
    f.fatura !== null ||
    f.valorMin !== null ||
    f.valorMax !== null ||
    f.semZeradas
  );
}

/** O intervalo é exatamente um mês-calendário inteiro? Devolve "aaaa-mm" ou null. */
function mesCompleto(de: string | null, ate: string | null): string | null {
  if (!de || !ate) return null;
  const mes = de.slice(0, 7);
  const inteiro = periodoEfetivo({ mes, de: null, ate: null });
  return inteiro.de === de && inteiro.ate === ate ? mes : null;
}

/** Nome do arquivo: ASCII, sem espaço. "Receita_2026-10.xlsx", "Receita_2026-08-01_a_2026-10-31_filtrado.xlsx". */
export function nomeDoArquivoReceita(f: FiltrosReceita, extensao = "xlsx"): string {
  const { de, ate } = periodoEfetivo(f);
  let periodo: string;
  const mesInteiro = mesCompleto(de, ate);
  if (mesInteiro) periodo = mesInteiro;
  else if (de && ate) periodo = `${de}_a_${ate}`;
  else if (de) periodo = `desde_${de}`;
  else if (ate) periodo = `ate_${ate}`;
  else periodo = "todos-os-meses";
  return `Receita_${periodo}${temFiltroAlemDoPeriodo(f) ? "_filtrado" : ""}.${extensao}`;
}
