import { todayKey } from "@/lib/dates";
import { formatBRL, money, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import type { LinhaDaComposicao, LinhaExcluidaDaComposicao } from "@/lib/clickup/composicao";
import type { Sheet } from "@/lib/xlsx/writer";
import { validarParametros, lerSimNao, lista, um, type ParamsBrutos } from "./parametros";
import { contagem } from "./plural";
import { abaDeDetalhe, abaDeTabela, abaLeiaMe, type ColunaTabela, type Detalhe, type EsperadoNaAba } from "./planilha";
import { textoSeguro } from "./texto";
import { ExportacaoInconsistenteError, ExportacaoNegadaError, type ColunaDef, type TipoColuna, type UsuarioExport } from "./tipos";

/**
 * Exportação do ESPELHO DA RECEITA NO CLICKUP (ADR-0035) — a parte PURA: pedido, colunas e montagem das abas. Sem banco.
 *
 * O ClickUp é só um espelho (ADR-0023): cada VÍNCULO liga uma categoria + padrões de texto a uma tarefa, e o painel
 * empurra para o campo do mês o total das linhas de receita que o vínculo soma. Esta planilha responde "de onde veio o
 * número que está na tarefa X?" — vínculos, COMPOSIÇÃO (quais faturas somam) e envios.
 *
 * ⚠ A composição NÃO é reimplementada aqui: quem a calcula é `composicaoDoVinculo` (clickup/composicao.ts, a MESMA
 * função do envio e da tela de detalhamento — a única forma de a planilha nunca divergir do valor empurrado). Este módulo
 * só recebe o resultado, confere-o e o apresenta. O histórico de envios guarda só o TOTAL, nunca as linhas: a
 * composição exportada é sempre um RECÁLCULO com os dados de agora, e o Resumo mostra a diferença para o último envio.
 *
 * ⚠ SÓ `Valor atribuído ao vínculo` SOMA. `Valor da linha (Cat.)` é a fatura inteira naquela categoria e se repete
 * quando a fatura é dividida entre tarefas (ADR-0028); as linhas EXCLUÍDAS (que ficaram com outro vínculo) nunca somam.
 */

export const NOME_ABA_PRINCIPAL = "Composição";
export const COLUNA_VALOR_CLICKUP = "valorAtribuido";
/** Acima disto a geração (uma consulta por vínculo) merece uma nota no Leia-me. */
export const LIMITE_VINCULOS_LENTO = 300;
export const URL_TAREFA_CLICKUP = "https://app.clickup.com/t/";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "Novembro de 2026". */
export function rotuloDoMes(ano: number, mes: number): string {
  const nome = MESES[mes - 1] ?? String(mes);
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

export interface PedidoClickUp {
  ano: number;
  /** 1..12 */
  mes: number;
  /** Strings EXATAS das categorias (espaços duplos são reais); vazio = todas as que têm vínculo. */
  categorias: string[];
  /** Só vínculos ATIVOS entram na composição (os inativos aparecem na aba Vínculos). */
  somenteAtivos: boolean;
}

/**
 * Lê o pedido da URL. Valor malformado vira ERRO: apurar o mês errado de um dinheiro entregaria um número que parece
 * certo. `ano` e `mes` vêm juntos ou nenhum dos dois (o padrão é o mês corrente no fuso do app): só um deles seria
 * ambíguo ("?ano=2025" — qual mês?).
 */
export function lerPedidoClickUp(params: ParamsBrutos, hojeKey: string = todayKey()): { pedido: PedidoClickUp; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f"], erros);

  let ano = Number(hojeKey.slice(0, 4));
  let mes = Number(hojeKey.slice(5, 7));
  const anoBruto = um(params.ano);
  const mesBruto = um(params.mes);
  if (lista(params.ano, 5, 20).length > 1) erros.push("Informe um único ano.");
  if (lista(params.mes, 5, 20).length > 1) erros.push("Informe um único mês.");
  if ((anoBruto === "") !== (mesBruto === "")) erros.push("Informe o ano e o mês juntos (ou nenhum dos dois, para usar o mês corrente).");
  if (anoBruto) {
    if (/^\d{4}$/.test(anoBruto) && Number(anoBruto) >= 2000 && Number(anoBruto) <= 2100) ano = Number(anoBruto);
    else erros.push(`Ano inválido ("${anoBruto.slice(0, 10)}"): use quatro dígitos, entre 2000 e 2100.`);
  }
  if (mesBruto) {
    if (/^\d{1,2}$/.test(mesBruto) && Number(mesBruto) >= 1 && Number(mesBruto) <= 12) mes = Number(mesBruto);
    else erros.push(`Mês inválido ("${mesBruto.slice(0, 10)}"): use um número de 1 a 12.`);
  }

  // Caixa de seleção desmarcada some da URL: com o formulário enviado (f), ausente = desmarcada; `0`/`1` explícito vale sempre.
  const somenteAtivos = lerSimNao(params, "somenteAtivos", "Somente vínculos ativos", true, enviado, erros);
  return { pedido: { ano, mes, categorias: lista(params.categoria, 60, 200), somenteAtivos }, erros };
}

/** Categorias pedidas que não têm NENHUM vínculo: erro explícito (um filtro que não casa nada entregaria planilha vazia). */
export function erroDeCategoriasDesconhecidas(pedido: PedidoClickUp, existentes: Iterable<string>): string[] {
  const conhecidas = new Set(existentes);
  const faltam = pedido.categorias.filter((c) => !conhecidas.has(c));
  if (faltam.length === 0) return [];
  return [`Categoria sem vínculo no ClickUp: ${faltam.map((c) => `"${c.slice(0, 80)}"`).join(", ")}. Escolha categorias que tenham vínculo cadastrado.`];
}

export function descreverPedidoClickUp(p: PedidoClickUp): Array<[string, string]> {
  return [
    ["Mês de apuração (Data de Crédito)", rotuloDoMes(p.ano, p.mes)],
    ["Categoria", p.categorias.length ? p.categorias.join("; ") : "todas as que têm vínculo"],
    ["Vínculos na composição", p.somenteAtivos ? "somente ativos (os inativos aparecem só na aba Vínculos)" : "ativos e inativos"],
  ];
}

export function nomeDoArquivoClickUp(p: PedidoClickUp, extensao = "xlsx"): string {
  const mes = String(p.mes).padStart(2, "0");
  return `ClickUp_composicao_${p.ano}-${mes}${p.categorias.length ? "_filtrado" : ""}${p.somenteAtivos ? "" : "_com_inativos"}.${extensao}`;
}

/** Defesa em profundidade: a rota e o despachante já recusam, e o gerador confere de novo (o link pode ser montado à mão). */
export function exigirAdministrador(usuario: UsuarioExport): void {
  if (usuario.papel !== "ADMIN") {
    throw new ExportacaoNegadaError("O espelho do ClickUp (vínculos, composição e envios) só pode ser exportado por administradores.");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// O que o servidor entrega (já em tipos simples)
// ---------------------------------------------------------------------------------------------------------------

export interface EnvioClickUp {
  vinculoId: string;
  ano: number;
  mes: number;
  /** "1234.56" */
  valor: string;
  sucesso: boolean;
  erro: string | null;
  /** Relógio de parede (fuso do app): o Excel não tem fuso. */
  quando: Date;
}

export interface VinculoClickUp {
  id: string;
  categoria: string;
  padroes: string[];
  clickUpTaskId: string;
  clickUpListId: string;
  ativo: boolean;
  criadoPorNome: string | null;
  /** Relógio de parede. */
  criadoEm: Date;
  /** O envio mais recente de QUALQUER mês, com ou sem sucesso (o que a tela Integração ClickUp mostra). */
  ultimoEnvio: EnvioClickUp | null;
}

/** O resultado de `composicaoDoVinculo` para um vínculo, ou o motivo de não ter sido calculada. */
export interface ComposicaoExportada {
  vinculo: VinculoClickUp;
  incluidas: LinhaDaComposicao[];
  excluidas: LinhaExcluidaDaComposicao[];
  /** `composicao.total` ("1234.56"); null quando a composição não pôde ser calculada. */
  total: string | null;
  /** Por que não foi calculada (vínculo sem padrão…); marcado na planilha, nunca omitido. */
  erro: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Conferências PURAS (vazio = fechou)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Para CADA vínculo: a soma de `valorAtribuido` das linhas listadas tem de ser IGUAL ao total da composição (Decimal) — é
 * o número que o painel empurra ao ClickUp. Pega linha perdida ou duplicada na listagem. Também recusa linha repetida
 * dentro de um vínculo e linha ao mesmo tempo incluída e excluída (a composição nunca produz isso).
 */
export function conferirComposicoes(comps: readonly ComposicaoExportada[]): string[] {
  const problemas: string[] = [];
  for (const c of comps) {
    const nome = `${c.vinculo.clickUpTaskId} (${c.vinculo.categoria})`;
    if (c.erro !== null) {
      if (c.incluidas.length > 0 || c.excluidas.length > 0 || c.total !== null) problemas.push(`${nome}: composição com erro não pode trazer linhas nem total`);
      continue;
    }
    if (c.total === null) {
      problemas.push(`${nome}: composição sem total`);
      continue;
    }
    const soma = sum(c.incluidas.map((l) => l.valorAtribuido));
    if (!soma.equals(money(c.total))) {
      problemas.push(`${nome}: as ${c.incluidas.length} linha(s) listada(s) somam ${toAmountString(soma)}, mas a composição diz ${toAmountString(money(c.total))}`);
    }
    const ids = new Set<string>();
    for (const l of c.incluidas) {
      if (ids.has(l.id)) problemas.push(`${nome}: a linha ${l.id} (fatura ${l.crConexaId}) aparece duas vezes`);
      ids.add(l.id);
    }
    for (const l of c.excluidas) {
      if (ids.has(l.id)) problemas.push(`${nome}: a linha ${l.id} (fatura ${l.crConexaId}) está ao mesmo tempo incluída e excluída`);
    }
  }
  return problemas;
}

/** Uma linha de `revenue_categorized_lines` como o banco a devolve agora (releitura na transação de leitura). */
export interface LinhaDoBanco {
  id: string;
  crConexaId: number;
  categoria: string;
  dataCredito: Date | null;
  /** "1234.56" */
  valorRecebidoCat: string;
}

/**
 * As linhas que a planilha mostra (incluídas E excluídas) existem no banco, na categoria do vínculo, dentro do mês, com a
 * mesma fatura e o mesmo valor? Pega composição lida de um instante e planilha montada de outro, e linha inventada.
 */
export function conferirContraBancoClickUp(
  comps: readonly ComposicaoExportada[],
  banco: ReadonlyMap<string, LinhaDoBanco>,
  periodo: { de: Date; ateExclusivo: Date },
): string[] {
  const problemas: string[] = [];
  let omitidos = 0;
  const registrar = (p: string): void => {
    if (problemas.length < 12) problemas.push(p);
    else omitidos += 1;
  };
  for (const c of comps) {
    for (const l of [...c.incluidas, ...c.excluidas]) {
      const onde = `${c.vinculo.clickUpTaskId}, fatura ${l.crConexaId}`;
      const b = banco.get(l.id);
      if (!b) {
        registrar(`${onde}: a linha ${l.id} não existe mais no banco`);
        continue;
      }
      if (b.crConexaId !== l.crConexaId) registrar(`${onde}: o banco diz fatura ${b.crConexaId}`);
      if (b.categoria !== c.vinculo.categoria) registrar(`${onde}: o banco tem a linha na categoria "${b.categoria}", o vínculo é de "${c.vinculo.categoria}"`);
      if (!b.dataCredito || b.dataCredito < periodo.de || b.dataCredito >= periodo.ateExclusivo) {
        registrar(`${onde}: a Data de Crédito da linha no banco (${b.dataCredito ? b.dataCredito.toISOString().slice(0, 10) : "vazia"}) está fora do mês pedido`);
      }
      if (!money(b.valorRecebidoCat).equals(money(l.valorRecebidoCat))) {
        registrar(`${onde}: a linha vale ${toAmountString(money(l.valorRecebidoCat))} na planilha e ${toAmountString(money(b.valorRecebidoCat))} no banco`);
      }
    }
  }
  if (omitidos > 0) problemas.push(`… e mais ${omitidos} divergência(s)`);
  return problemas;
}

/**
 * A composição lê o banco POR CONTA PRÓPRIA (não dá para pô-la dentro da transação de leitura), então o gerador tira uma
 * "impressão digital" das linhas do mês ANTES e DEPOIS: se mudou no meio (uma sincronização de 15 min gravou), refaz em
 * vez de entregar uma mistura de dois instantes.
 */
export interface ImpressaoDasLinhas {
  linhas: number;
  /** "1234.56" */
  soma: string;
  /** Instante (ms) da última atualização de uma linha do recorte; null sem linhas. */
  ultimaAtualizacao: number | null;
}

export function impressoesIguais(a: ImpressaoDasLinhas, b: ImpressaoDasLinhas): boolean {
  return a.linhas === b.linhas && money(a.soma).equals(money(b.soma)) && a.ultimaAtualizacao === b.ultimaAtualizacao;
}

/** O que identifica o estado de um vínculo para a composição: quem é, a que categoria pertence, os padrões e se está ativo. */
export function assinaturaDosVinculos(
  vinculos: ReadonlyArray<{ id: string; categoria: string; padroes: unknown; ativo: boolean; clickUpTaskId: string; atualizadoEm: Date }>,
): string {
  return JSON.stringify(
    [...vinculos]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((v) => [v.id, v.categoria, v.padroes, v.ativo, v.clickUpTaskId, v.atualizadoEm.getTime()]),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------------------------

const simNao = (b: boolean): string => (b ? "Sim" : "Não");
const cmpTexto = (a: string, b: string): number => a.localeCompare(b, "pt-BR");
const pad2 = (n: number): string => String(n).padStart(2, "0");
/** "26.25" → "26,25" (valor dentro de um TEXTO que gente lê; a célula de dinheiro continua número exato). */
const brSemSimbolo = (v: string): string => toAmountString(money(v)).replace(".", ",");

function textoDosItens(itens: ReadonlyArray<{ servicoItem: string; valor: string }>): string {
  return itens.map((i) => `${i.servicoItem} (${brSemSimbolo(i.valor)})`).join("; ");
}

/** Para onde foi uma linha excluída: a tarefa que ficou com ela, ou a divisão item a item entre as tarefas. */
function ficouCom(l: LinhaExcluidaDaComposicao): string {
  if (l.repartidaEntre && l.repartidaEntre.length > 0) {
    return l.repartidaEntre.map((p) => `${p.taskId}: ${p.servicoItem} (${brSemSimbolo(p.valor)})`).join("; ");
  }
  return l.reivindicadaPorTaskId;
}

// ---------------------------------------------------------------------------------------------------------------
// Aba principal: Composição (uma linha por LINHA de receita incluída em cada vínculo)
// ---------------------------------------------------------------------------------------------------------------

export interface LinhaDaPlanilha {
  categoria: string;
  tarefa: string;
  vinculoAtivo: boolean;
  crConexaId: number;
  cliente: string | null;
  servico: string;
  dataCredito: Date | null;
  valorLinha: string;
  valorAtribuido: string;
  modo: string;
  dividida: boolean;
  itens: string | null;
  proporcionado: string;
  revisada: boolean;
  alerta: string | null;
}

export const COLUNAS_COMPOSICAO: ColunaDef<LinhaDaPlanilha>[] = [
  { id: "categoria", titulo: "Categoria do vínculo", grupo: "essenciais", tipo: "texto", largura: 34, valor: (l) => l.categoria, campos: ["categoria"] },
  // Id da tarefa é TEXTO (alfanumérico; "0123" não pode perder o zero nem virar número).
  { id: "tarefa", titulo: "Tarefa ClickUp", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => l.tarefa, campos: ["tarefa"] },
  { id: "ativo", titulo: "Vínculo ativo", grupo: "essenciais", tipo: "texto", largura: 10, valor: (l) => simNao(l.vinculoAtivo), campos: ["vinculoAtivo"] },
  { id: "idFatura", titulo: "ID Fatura", grupo: "essenciais", tipo: "id", largura: 11, valor: (l) => l.crConexaId, campos: ["crConexaId"] },
  { id: "cliente", titulo: "Cliente", grupo: "essenciais", tipo: "texto", largura: 38, valor: (l) => l.cliente, campos: ["cliente"] },
  { id: "servico", titulo: "Serviço/Plano (Conexa)", grupo: "essenciais", tipo: "texto", largura: 46, valor: (l) => l.servico, campos: ["servico"] },
  { id: "dataCredito", titulo: "Data Crédito", grupo: "essenciais", tipo: "data", largura: 13, valor: (l) => l.dataCredito, campos: ["dataCredito"] },
  { id: "valorLinha", titulo: "Valor da linha (Cat.) — NÃO somar", grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.valorLinha, campos: ["valorLinha"] },
  { id: COLUNA_VALOR_CLICKUP, titulo: "Valor atribuído ao vínculo", grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.valorAtribuido, campos: ["valorAtribuido"] },
  { id: "modo", titulo: "Modo", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => l.modo, campos: ["modo"] },
  { id: "dividida", titulo: "Dividida", grupo: "essenciais", tipo: "texto", largura: 10, valor: (l) => simNao(l.dividida), campos: ["dividida"] },
  { id: "itens", titulo: "Itens atribuídos a este vínculo", grupo: "essenciais", tipo: "texto", largura: 60, valor: (l) => l.itens, campos: ["itens"] },
  { id: "proporcionado", titulo: "Proporcionado", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => l.proporcionado, campos: ["proporcionado"] },
  { id: "revisada", titulo: "Revisada manualmente", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => simNao(l.revisada), campos: ["revisada"] },
  { id: "alerta", titulo: "Alerta", grupo: "essenciais", tipo: "texto", largura: 50, valor: (l) => l.alerta, campos: ["alerta"] },
];

// ---------------------------------------------------------------------------------------------------------------
// Abas de tabela simples: definição de coluna com o valor ao lado (sem desalinhar posição e cabeçalho)
// ---------------------------------------------------------------------------------------------------------------

interface ColTabela<L> extends ColunaTabela {
  id: string;
  valor: (l: L) => string | number | Date | null | undefined;
}

function tabelaDe<L>(nome: string, defs: ColTabela<L>[], linhas: L[], extras: { total?: Record<string, string | number | null>; nota?: string; autoFiltro?: boolean } = {}): Sheet {
  return abaDeTabela({
    nome,
    colunas: defs,
    linhas: linhas.map((l) => defs.map((d) => d.valor(l))),
    // O primeiro valor da linha TOTAL vira o rótulo; os demais entram pelo id da coluna.
    ...(extras.total ? { total: defs.map((d, i) => (i === 0 ? "TOTAL" : (extras.total![d.id] ?? null))) } : {}),
    ...(extras.nota ? { nota: extras.nota } : {}),
    ...(extras.autoFiltro === false ? { autoFiltro: false } : {}),
  });
}

const col = <L>(id: string, titulo: string, tipo: TipoColuna, largura: number, valor: ColTabela<L>["valor"]): ColTabela<L> => ({ id, titulo, tipo, largura, valor });

// ---------------------------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaPastaClickUp {
  pedido: PedidoClickUp;
  /** TODOS os vínculos do recorte de categoria (ativos e inativos) — aba Vínculos. */
  vinculos: VinculoClickUp[];
  /** Os vínculos que entraram na composição (ativos, ou todos quando `somenteAtivos` é falso). */
  composicoes: ComposicaoExportada[];
  /** Envios (ClickUpPushLog) do mês pedido, dos vínculos do recorte. */
  envios: EnvioClickUp[];
  geradoEm: Date;
  usuario: UsuarioExport;
  /** A atualidade da RECEITA (a composição vem das linhas de receita). */
  frescor: { texto: string; alerta: boolean };
  /** "aaaa-mm-dd" — decide se o mês pedido é o corrente, um passado ou um futuro. */
  hoje: string;
  /** CSV: só a aba principal (as outras não existem no arquivo, então nem são montadas). */
  soPrincipal?: boolean;
}

export interface SaidaPastaClickUp {
  abas: Sheet[];
  detalhe: Detalhe;
  /** Soma de "Valor atribuído ao vínculo" (decimal exato). */
  total: Money;
  linhasComposicao: number;
  linhasExcluidas: number;
  linhasEnvios: number;
  titulosDasColunas: string[];
  /** O que `entregar()` precisa conferir lendo o arquivo de volta (só a principal quando `soPrincipal`). */
  esperado: EsperadoNaAba[];
  /** Linhas marcadas com alerta de possível dupla contagem. */
  alertas: number;
}

const ordemDosVinculos = (a: VinculoClickUp, b: VinculoClickUp): number =>
  Number(b.ativo) - Number(a.ativo) ||
  cmpTexto(a.categoria, b.categoria) ||
  cmpTexto(a.padroes.join("|"), b.padroes.join("|")) ||
  cmpTexto(a.clickUpTaskId, b.clickUpTaskId);

/** Data de Crédito (ISO) → fatura → id: a mesma ordem da tela de detalhamento, com desempate total. */
function ordemDasLinhas(a: LinhaDaComposicao, b: LinhaDaComposicao): number {
  const da = a.dataCredito ?? "9999-12-31";
  const db = b.dataCredito ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (a.crConexaId !== b.crConexaId) return a.crConexaId - b.crConexaId;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Linha atribuída, somando os vínculos ATIVOS, a mais do que ela vale? A composição garante que não (ADR-0028: o modo é
 * propriedade da LINHA, todos os vínculos concordam, e o ajuste é creditado uma vez) — mas se acontecer é dinheiro que o
 * painel empurraria em dobro, e a planilha tem de MOSTRAR, não esconder nem consertar. Os inativos ficam de fora: a
 * composição deles é hipotética e pode legitimamente repetir o que um vínculo ativo já leva.
 */
function alertasDeDuplicidade(comps: readonly ComposicaoExportada[]): Map<string, string> {
  const porLinha = new Map<string, { atribuido: Money; linha: Money }>();
  for (const c of comps) {
    if (!c.vinculo.ativo || c.erro !== null) continue;
    for (const l of c.incluidas) {
      const g = porLinha.get(l.id) ?? { atribuido: ZERO, linha: money(l.valorRecebidoCat) };
      g.atribuido = g.atribuido.plus(money(l.valorAtribuido));
      porLinha.set(l.id, g);
    }
  }
  const alertas = new Map<string, string>();
  for (const [id, g] of porLinha) {
    // Em módulo: uma linha de estorno (valor negativo) também não pode ser levada em dobro.
    if (g.atribuido.abs().gt(g.linha.abs())) {
      alertas.set(
        id,
        `A soma atribuída a todos os vínculos ativos (${formatBRL(g.atribuido)}) passa do valor da linha (${formatBRL(g.linha)}): possível dupla contagem, ou item de valor negativo. Não corrigido aqui.`,
      );
    }
  }
  return alertas;
}

type SituacaoResumo = "conciliado" | "diferente" | "sem_envio" | "inativo" | "erro";

function situacaoDoVinculo(c: ComposicaoExportada, ultimoOk: EnvioClickUp | null, falhas: number, diferenca: string | null): { codigo: SituacaoResumo; texto: string } {
  if (c.erro !== null) return { codigo: "erro", texto: `NÃO CALCULADO: ${c.erro}` };
  if (!c.vinculo.ativo) return { codigo: "inativo", texto: "Inativo: o painel não envia este vínculo (o total é o que enviaria se estivesse ativo)" };
  if (ultimoOk === null) {
    return { codigo: "sem_envio", texto: falhas > 0 ? `Sem envio com sucesso neste mês (${falhas} falha(s))` : "Sem envio neste mês" };
  }
  return money(diferenca ?? "0").isZero()
    ? { codigo: "conciliado", texto: "Conciliado com o último envio" }
    : { codigo: "diferente", texto: "Diferente do último envio: a receita mudou depois dele" };
}

interface LinhaResumo {
  categoria: string;
  tarefa: string;
  padroes: string;
  ativo: boolean;
  linhas: number | null;
  excluidas: number | null;
  total: string | null;
  enviado: string | null;
  enviadoEm: Date | null;
  diferenca: string | null;
  situacao: string;
  codigo: SituacaoResumo;
}

export function montarAbasClickUp(e: EntradaPastaClickUp): SaidaPastaClickUp {
  const comps = [...e.composicoes].sort((a, b) => ordemDosVinculos(a.vinculo, b.vinculo));
  const divergencias = conferirComposicoes(comps);
  if (divergencias.length > 0) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${divergencias.join("; ")}.`);
  }

  // --- Composição (a aba principal) -------------------------------------------------------------------------------
  const alertas = alertasDeDuplicidade(comps);
  const linhas: LinhaDaPlanilha[] = comps.flatMap((c) =>
    [...c.incluidas].sort(ordemDasLinhas).map((l) => ({
      categoria: c.vinculo.categoria,
      tarefa: c.vinculo.clickUpTaskId,
      vinculoAtivo: c.vinculo.ativo,
      crConexaId: l.crConexaId,
      cliente: l.razaoSocial,
      servico: l.servicoOuPlano,
      dataCredito: l.dataCredito ? new Date(l.dataCredito) : null,
      valorLinha: toAmountString(money(l.valorRecebidoCat)),
      valorAtribuido: toAmountString(money(l.valorAtribuido)),
      modo: l.modo,
      dividida: l.dividida,
      itens: l.itensAtribuidos && l.itensAtribuidos.length > 0 ? textoDosItens(l.itensAtribuidos) : null,
      proporcionado: l.proporcionado,
      revisada: l.revisadoManualmente,
      alerta: c.vinculo.ativo ? (alertas.get(l.id) ?? null) : null,
    })),
  );
  const detalhe = abaDeDetalhe({ nome: NOME_ABA_PRINCIPAL, colunas: COLUNAS_COMPOSICAO, linhas, colunaTotal: COLUNA_VALOR_CLICKUP });
  const total = sum(linhas.map((l) => l.valorAtribuido));
  const totalStr = toAmountString(total);
  const titulosDasColunas = COLUNAS_COMPOSICAO.map((c) => c.titulo);
  const linhasAlertadas = linhas.filter((l) => l.alerta !== null).length;
  const esperadoPrincipal: EsperadoNaAba = { nomeAba: NOME_ABA_PRINCIPAL, titulos: titulosDasColunas, nLinhas: linhas.length, indiceValor: detalhe.indiceColunaTotal, total: totalStr };

  // Os dois totais saem de caminhos independentes (a soma das composições × a soma das linhas do arquivo).
  const somaDasComposicoes = sum(comps.map((c) => c.total));
  if (!somaDasComposicoes.equals(total)) {
    throw new ExportacaoInconsistenteError(
      `A conferência interna não fechou — o arquivo não foi entregue. Soma das composições (${toAmountString(somaDasComposicoes)}) ≠ soma das linhas da aba ${NOME_ABA_PRINCIPAL} (${totalStr}).`,
    );
  }
  if (detalhe.total !== null && detalhe.total !== totalStr) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. Rodapé da aba ${NOME_ABA_PRINCIPAL} (${detalhe.total}) ≠ ${totalStr}.`);
  }

  const linhasExcluidas = comps.reduce((n, c) => n + c.excluidas.length, 0);
  const enviosOrdenados = [...e.envios].sort((a, b) => a.quando.getTime() - b.quando.getTime());

  if (e.soPrincipal) {
    return { abas: [detalhe.aba], detalhe, total, linhasComposicao: linhas.length, linhasExcluidas, linhasEnvios: enviosOrdenados.length, titulosDasColunas, esperado: [esperadoPrincipal], alertas: linhasAlertadas };
  }

  // --- Vínculos ---------------------------------------------------------------------------------------------------
  const vinculos = [...e.vinculos].sort(ordemDosVinculos);
  const defsVinculos: ColTabela<VinculoClickUp>[] = [
    col("id", "ID do vínculo", "texto", 28, (v) => v.id),
    col("categoria", "Categoria", "texto", 34, (v) => v.categoria),
    col("padroes", "Padrões (qualquer um casa)", "texto", 50, (v) => v.padroes.join(" | ")),
    col("tarefa", "Tarefa ClickUp", "texto", 14, (v) => v.clickUpTaskId),
    col("link", "Link da tarefa", "texto", 44, (v) => `${URL_TAREFA_CLICKUP}${v.clickUpTaskId}`),
    col("lista", "Lista ClickUp", "texto", 16, (v) => v.clickUpListId),
    col("ativo", "Ativo", "texto", 8, (v) => simNao(v.ativo)),
    col("criadoPor", "Criado por", "texto", 26, (v) => v.criadoPorNome),
    col("criadoEm", "Criado em", "datahora", 17, (v) => v.criadoEm),
    // Em envio com FALHA o valor é o que se tentou enviar e NÃO está no ClickUp (a tela mostra "Falhou" no lugar dele).
    col("ultValor", "Último envio: valor (se falhou, não chegou ao ClickUp)", "dinheiro", 26, (v) => v.ultimoEnvio?.valor),
    col("ultMes", "Último envio: mês/ano", "texto", 13, (v) => (v.ultimoEnvio ? `${pad2(v.ultimoEnvio.mes)}/${v.ultimoEnvio.ano}` : null)),
    col("ultQuando", "Último envio: quando", "datahora", 17, (v) => v.ultimoEnvio?.quando),
    col("ultSucesso", "Último envio: sucesso", "texto", 14, (v) => (v.ultimoEnvio ? simNao(v.ultimoEnvio.sucesso) : "Nunca enviado")),
    col("ultErro", "Último envio: erro", "texto", 60, (v) => v.ultimoEnvio?.erro),
  ];
  const abaVinculos = tabelaDe("Vínculos", defsVinculos, vinculos, {
    nota: "Cada vínculo liga uma categoria + padrões de texto (qualquer um casa) a uma tarefa do ClickUp. 'Último envio' é o mais recente de QUALQUER mês, com ou sem sucesso, como na tela Integração ClickUp.",
  });

  // --- Resumo por vínculo -----------------------------------------------------------------------------------------
  const enviosPorVinculo = new Map<string, EnvioClickUp[]>();
  for (const x of enviosOrdenados) enviosPorVinculo.set(x.vinculoId, [...(enviosPorVinculo.get(x.vinculoId) ?? []), x]);

  const resumo: LinhaResumo[] = comps.map((c) => {
    const dele = enviosPorVinculo.get(c.vinculo.id) ?? [];
    // Só envio com SUCESSO representa o que está no campo do ClickUp (a tela faz o mesmo): `>=` deixa o mais recente vencer empate.
    const ultimoOk = dele.filter((x) => x.sucesso).reduce<EnvioClickUp | null>((m, x) => (m === null || x.quando.getTime() >= m.quando.getTime() ? x : m), null);
    const enviado = ultimoOk ? toAmountString(money(ultimoOk.valor)) : null;
    const diferenca = c.total !== null && enviado !== null ? toAmountString(money(c.total).minus(money(enviado))) : null;
    const s = situacaoDoVinculo(c, ultimoOk, dele.filter((x) => !x.sucesso).length, diferenca);
    return {
      categoria: c.vinculo.categoria,
      tarefa: c.vinculo.clickUpTaskId,
      padroes: c.vinculo.padroes.join(" | "),
      ativo: c.vinculo.ativo,
      linhas: c.erro === null ? c.incluidas.length : null,
      excluidas: c.erro === null ? c.excluidas.length : null,
      total: c.total === null ? null : toAmountString(money(c.total)),
      enviado,
      enviadoEm: ultimoOk?.quando ?? null,
      diferenca,
      situacao: s.texto,
      codigo: s.codigo,
    };
  });
  const somaEnviados = sum(resumo.map((r) => r.enviado));
  const somaDiferencas = sum(resumo.map((r) => r.diferenca));
  const comEnvio = resumo.filter((r) => r.enviado !== null).length;
  const defsResumo: ColTabela<LinhaResumo>[] = [
    col("categoria", "Categoria", "texto", 34, (r) => r.categoria),
    col("tarefa", "Tarefa ClickUp", "texto", 14, (r) => r.tarefa),
    col("padroes", "Padrões", "texto", 40, (r) => r.padroes),
    col("ativo", "Ativo", "texto", 8, (r) => simNao(r.ativo)),
    col("linhas", "Linhas", "inteiro", 9, (r) => r.linhas),
    col("excluidas", "Excluídas (ficaram com outro vínculo)", "inteiro", 20, (r) => r.excluidas),
    col("total", "Total atribuído (o que o painel envia)", "dinheiro", 24, (r) => r.total),
    col("enviado", "Último valor enviado neste mês", "dinheiro", 24, (r) => r.enviado),
    col("enviadoEm", "Enviado em", "datahora", 17, (r) => r.enviadoEm),
    col("diferenca", "Diferença (atribuído − enviado)", "dinheiro", 22, (r) => r.diferenca),
    col("situacao", "Situação", "texto", 56, (r) => r.situacao),
  ];
  const abaResumo = tabelaDe("Resumo por vínculo", defsResumo, resumo, {
    total: {
      linhas: resumo.reduce((n, r) => n + (r.linhas ?? 0), 0),
      excluidas: resumo.reduce((n, r) => n + (r.excluidas ?? 0), 0),
      total: totalStr,
      enviado: toAmountString(somaEnviados),
      diferenca: toAmountString(somaDiferencas),
    },
    nota:
      `'Total atribuído' é o valor que o painel envia (ou enviaria, nos inativos) ao ClickUp para este mês. 'Último valor enviado' é o do último envio COM SUCESSO deste mês; ` +
      `as colunas de enviado e de diferença somam só os ${comEnvio} vínculo(s) que têm envio com sucesso. 'Excluídas' não soma dinheiro: são linhas que casam o padrão mas ficaram com outro vínculo.`,
  });

  // --- Excluídas (informativa: NUNCA somada) -----------------------------------------------------------------------
  interface LinhaExcl {
    categoria: string;
    tarefa: string;
    linha: LinhaExcluidaDaComposicao;
  }
  const excluidas: LinhaExcl[] = comps.flatMap((c) => [...c.excluidas].sort(ordemDasLinhas).map((linha) => ({ categoria: c.vinculo.categoria, tarefa: c.vinculo.clickUpTaskId, linha })));
  const defsExcl: ColTabela<LinhaExcl>[] = [
    col("categoria", "Categoria do vínculo", "texto", 34, (x) => x.categoria),
    col("tarefa", "Tarefa ClickUp (que NÃO soma esta linha)", "texto", 22, (x) => x.tarefa),
    col("idFatura", "ID Fatura", "id", 11, (x) => x.linha.crConexaId),
    col("cliente", "Cliente", "texto", 38, (x) => x.linha.razaoSocial),
    col("servico", "Serviço/Plano (Conexa)", "texto", 46, (x) => x.linha.servicoOuPlano),
    col("dataCredito", "Data Crédito", "data", 13, (x) => (x.linha.dataCredito ? new Date(x.linha.dataCredito) : null)),
    col("valorLinha", "Valor da linha (Cat.) — NÃO somar", "dinheiro", 22, (x) => toAmountString(money(x.linha.valorRecebidoCat))),
    col("modo", "Modo", "texto", 14, (x) => x.linha.modo),
    col("ficouCom", "Ficou com (tarefa)", "texto", 60, (x) => ficouCom(x.linha)),
  ];
  const abaExcluidas = tabelaDe("Excluídas", defsExcl, excluidas, {
    nota: "Linhas que casam o padrão do vínculo mas somam em OUTRO vínculo (fatura que combina produtos). Por item, a fatura é repartida entre as tarefas de cada produto; sem detalhe por item (fatura antiga, sem lançamento casado ou linha revisada à mão), a tarefa mais antiga fica com a linha inteira. Nada aqui soma.",
  });

  // --- Envios ------------------------------------------------------------------------------------------------------
  const porId = new Map(vinculos.map((v) => [v.id, v]));
  const desconhecidos = enviosOrdenados.filter((x) => !porId.has(x.vinculoId));
  if (desconhecidos.length > 0) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${desconhecidos.length} envio(s) de vínculo(s) que não estão no recorte.`);
  }
  const envios = enviosOrdenados
    .map((x) => ({ x, v: porId.get(x.vinculoId)! }))
    .sort((a, b) => cmpTexto(a.v.categoria, b.v.categoria) || cmpTexto(a.v.clickUpTaskId, b.v.clickUpTaskId) || a.x.quando.getTime() - b.x.quando.getTime());
  const defsEnvios: ColTabela<{ x: EnvioClickUp; v: VinculoClickUp }>[] = [
    col("categoria", "Categoria", "texto", 34, (r) => r.v.categoria),
    col("tarefa", "Tarefa ClickUp", "texto", 14, (r) => r.v.clickUpTaskId),
    col("ano", "Ano", "id", 8, (r) => r.x.ano),
    col("mes", "Mês", "id", 7, (r) => r.x.mes),
    col("valor", "Valor enviado (se falhou, não chegou ao ClickUp)", "dinheiro", 26, (r) => toAmountString(money(r.x.valor))),
    col("sucesso", "Sucesso", "texto", 9, (r) => simNao(r.x.sucesso)),
    col("erro", "Erro", "texto", 60, (r) => r.x.erro),
    col("quando", "Enviado em", "datahora", 17, (r) => r.x.quando),
  ];
  const abaEnvios = tabelaDe("Envios", defsEnvios, envios, {
    nota: "Cada linha é uma TENTATIVA de envio deste mês (o painel reenvia o vínculo sempre que o total muda). Não some: o valor de um envio com falha não chegou ao ClickUp, e os envios do mesmo vínculo se substituem.",
  });

  // --- Números do Leia-me -----------------------------------------------------------------------------------------
  const ativosNoRecorte = vinculos.filter((v) => v.ativo).length;
  const totalDosAtivos = sum(comps.filter((c) => c.vinculo.ativo).map((c) => c.total));
  const totalDosInativos = sum(comps.filter((c) => !c.vinculo.ativo).map((c) => c.total));
  const comErro = comps.filter((c) => c.erro !== null);
  const falhasNoMes = e.envios.filter((x) => !x.sucesso).length;
  const contar = (cod: SituacaoResumo) => resumo.filter((r) => r.codigo === cod).length;
  const temInativos = comps.some((c) => !c.vinculo.ativo);

  const mesPedido = `${e.pedido.ano}-${pad2(e.pedido.mes)}`;
  const mesDeHoje = e.hoje.slice(0, 7);
  const situacaoDoMes =
    mesPedido === mesDeHoje
      ? "O mês está em andamento: a composição muda a cada sincronização (a cada 15 minutos) e o painel reenvia o novo total ao ClickUp."
      : mesPedido > mesDeHoje
        ? "Este mês ainda não começou: não há receita a compor."
        : "Mês encerrado: o painel só envia o mês CORRENTE. A diferença para o último envio mostra o que mudou na receita depois dele (reprocessamento, revisão manual) e não se corrige sozinha.";

  const avisos = [
    "Só a coluna 'Valor atribuído ao vínculo' soma. 'Valor da linha (Cat.)' é a fatura inteira naquela categoria e se repete quando a fatura é dividida entre tarefas (Dividida = Sim).",
    "A composição é RECALCULADA agora, pela mesma regra do envio ao ClickUp (divisão por item da fatura). O histórico de envios guarda só o total, nunca quais faturas o compuseram: por isso 'Último valor enviado' pode diferir do total de hoje.",
    situacaoDoMes,
    "Cada linha de receita vai para UM vínculo, sem duplicar: por item (cada item vai para a tarefa do seu produto) ou, sem detalhe por item (fatura antiga, sem lançamento casado ou revisada manualmente), inteira para o vínculo ativo mais antigo que casar o padrão. O que casa o padrão mas ficou com outro vínculo está na aba Excluídas e nunca é somado.",
    "Proporcionado: N = fatura inteira numa só categoria; S = valor rateado entre categorias da mesma fatura; SEM_LV = sem item no Listar Vendas (a categoria veio do plano contratado).",
    "Na aba Envios, cada linha é uma tentativa: o valor de um envio com falha NÃO chegou ao ClickUp, e o mesmo vínculo é reenviado a cada mudança de total. Não some essa coluna.",
  ];
  if (temInativos) {
    avisos.push(
      "Esta planilha inclui vínculos INATIVOS: a composição deles é o que somariam se estivessem ativos (o painel não os envia) e pode repetir faturas que já estão em vínculos ativos. O que o painel realmente envia é o 'Total atribuído (vínculos ativos)' do Resultado; a soma da aba Composição mistura os dois.",
    );
  }
  if (linhasAlertadas > 0) {
    avisos.push(
      `ATENÇÃO: ${linhasAlertadas.toLocaleString("pt-BR")} linha(s) estão atribuídas, somando os vínculos ativos, a mais do que valem (possível dupla contagem). Estão marcadas na coluna Alerta da aba Composição; nada foi corrigido.`,
    );
  }
  if (comErro.length > 0) {
    avisos.push(
      `ATENÇÃO: ${comErro.length.toLocaleString("pt-BR")} vínculo(s) NÃO tiveram a composição calculada (veja 'Situação' no Resumo por vínculo): ficam sem linhas e sem total, e NÃO entram nas somas.`,
    );
  }
  if (comps.length > LIMITE_VINCULOS_LENTO) {
    avisos.push(
      `Esta exportação calculou ${comps.length.toLocaleString("pt-BR")} composições (uma consulta ao banco por vínculo): com tantos vínculos a geração é lenta. Filtrar por categoria acelera.`,
    );
  }

  const leiaMe = abaLeiaMe({
    titulo: "Exportação do espelho do ClickUp — Seahub Financeiro",
    geradoEm: e.geradoEm,
    // O Leia-me usa células de texto SEM a limpeza da tabela: tudo que vem do banco (nome, categoria, frase da sincronização)
    // passa por `textoSeguro` aqui — um caractere de controle num nome faria o Excel abrir o arquivo em modo de reparo.
    geradoPor: textoSeguro(`${e.usuario.nome} (${e.usuario.email})`),
    filtros: descreverPedidoClickUp(e.pedido).map(([k, v]): [string, string] => [k, textoSeguro(v)]),
    resultado: [
      ["Vínculos no recorte", `${vinculos.length.toLocaleString("pt-BR")} (${contagem(ativosNoRecorte, "ativo", "ativos")}, ${contagem(vinculos.length - ativosNoRecorte, "inativo", "inativos")})`],
      ["Vínculos com composição calculada", `${(comps.length - comErro.length).toLocaleString("pt-BR")} de ${comps.length.toLocaleString("pt-BR")}`],
      ["Linhas na composição", linhas.length.toLocaleString("pt-BR")],
      ["Total atribuído (vínculos ativos: o que o painel envia)", formatBRL(totalDosAtivos)],
      ...(temInativos
        ? ([
            ["Total atribuído (vínculos inativos: hipotético, não é enviado)", formatBRL(totalDosInativos)],
            ["Soma da coluna 'Valor atribuído' (ativos + inativos)", formatBRL(total)],
          ] as Array<[string, string]>)
        : []),
      ["Linhas excluídas (ficaram com outro vínculo; nunca somadas)", linhasExcluidas.toLocaleString("pt-BR")],
      ["Envios neste mês", `${e.envios.length.toLocaleString("pt-BR")} (${falhasNoMes.toLocaleString("pt-BR")} com falha)`],
      [
        "Conciliação com o último envio com sucesso (ativos)",
        `${contar("conciliado").toLocaleString("pt-BR")} conciliado(s), ${contar("diferente").toLocaleString("pt-BR")} diferente(s), ${contar("sem_envio").toLocaleString("pt-BR")} sem envio com sucesso neste mês`,
      ],
    ],
    frescor: { texto: textoSeguro(e.frescor.texto), alerta: e.frescor.alerta },
    avisos,
    conferencia:
      `OK. Em cada vínculo, a soma das linhas listadas igualou o total da composição; a soma da aba ${NOME_ABA_PRINCIPAL} (${formatBRL(total)}) fechou com a do Resumo por vínculo; ` +
      "as linhas foram relidas do banco e batem (fatura, categoria, mês e valor); e o arquivo, lido de volta, tem as mesmas linhas e a mesma soma — tudo antes de entregar.",
  });

  return {
    abas: [leiaMe, abaVinculos, detalhe.aba, abaResumo, abaExcluidas, abaEnvios],
    detalhe,
    total,
    linhasComposicao: linhas.length,
    linhasExcluidas,
    linhasEnvios: envios.length,
    titulosDasColunas,
    esperado: [
      esperadoPrincipal,
      { nomeAba: "Vínculos", titulos: defsVinculos.map((d) => d.titulo), nLinhas: vinculos.length, indiceValor: -1, total: null },
      { nomeAba: "Resumo por vínculo", titulos: defsResumo.map((d) => d.titulo), nLinhas: resumo.length, indiceValor: -1, total: null },
      { nomeAba: "Excluídas", titulos: defsExcl.map((d) => d.titulo), nLinhas: excluidas.length, indiceValor: -1, total: null },
      { nomeAba: "Envios", titulos: defsEnvios.map((d) => d.titulo), nLinhas: envios.length, indiceValor: -1, total: null },
    ],
    alertas: linhasAlertadas,
  };
}
