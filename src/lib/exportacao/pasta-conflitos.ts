import { classificarConflito, type ClassificacaoConflito, type LinhaConflito } from "@/lib/categorization/classificar-conflito";
import { formatBRL, money, sum, toAmountString, ZERO, type Money } from "@/lib/money";
import type { Sheet } from "@/lib/xlsx/writer";
import { validarParametros, lerSimNao, lista, um, type ParamsBrutos } from "./parametros";
import { abaDeDetalhe, abaDeTabela, abaLeiaMe, paraParede, type ColunaTabela, type Detalhe, type EsperadoNaAba } from "./planilha";
import { textoSeguro } from "./texto";
import {
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoNegadaError,
  MAX_LINHAS,
  type ColunaDef,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação de CONFLITOS (ADR-0035) — a parte PURA: pedido, colunas, conferências e montagem das abas. Sem banco.
 *
 * Um "conflito" é uma fatura, num mês de crédito, cujas linhas NÃO somam o valor da fatura (a "possível dupla contagem"
 * da tela /conflitos). A detecção NÃO é refeita aqui: a lista vem de `listarConflitos()` (a mesma da tela), e esta parte
 * só a organiza em planilha e a confere.
 *
 * ⚠ O conflito é por (fatura, MÊS de crédito), não por fatura (ADR-0029): uma fatura com problema em dois meses é dois
 * conflitos. E o "valor da fatura" é o de UMA parcela (o Conexa exporta uma parcela por cobrança).
 *
 * ⚠ SÓ `Valor Cat.` SOMA na aba principal. Valor da fatura, soma atual e diferença são do CONFLITO e se repetem em cada
 * linha dele — os títulos dizem "NÃO somar" (o mesmo cuidado da exportação de receita) e o Leia-me repete.
 */

// ---------------------------------------------------------------------------------------------------------------
// Classificações (o que cada uma significa e o que fazer — o texto que a tela Conflitos também dá)
// ---------------------------------------------------------------------------------------------------------------

export type ClassificacaoTipo = ClassificacaoConflito["tipo"];

export interface InfoClassificacao {
  /** Rótulo curto, em português, que aparece nas planilhas e na tela. */
  rotulo: string;
  significado: string;
  acao: string;
}

/**
 * `Record` sobre o tipo da união: se `classificar-conflito.ts` ganhar uma classificação nova, ESTE arquivo deixa de
 * compilar até ela ganhar rótulo e explicação — nenhuma classificação sai na planilha sem texto.
 */
export const INFO_CLASSIFICACAO: Record<ClassificacaoTipo, InfoClassificacao> = {
  duplicata_sem_categoria: {
    rotulo: "Duplicata em Sem Categoria",
    significado:
      'Há uma linha automática que ainda cai em "Sem Categoria" (o motor não consegue categorizar este serviço/plano sozinho, em toda rodada) e uma linha manual com a categoria real. ' +
      "Só a manual carrega informação; juntas, as duas contam a mesma receita duas vezes.",
    acao:
      'Na tela Conflitos, o botão "Resolver automaticamente" exclui a linha automática e passa a linha manual para a chave que o motor gera hoje (sem isso a duplicata voltaria a cada sincronização). ' +
      "Se o botão recusar, trate como ambíguo.",
  },
  manual_superada: {
    rotulo: "Revisão manual superada",
    significado:
      "As duas linhas já têm a MESMA categoria: uma regra real passou a existir depois da revisão manual e o motor agora categoriza sozinho. " +
      "A linha manual (com a chave antiga, que o motor não gera mais) ficou redundante.",
    acao: 'Na tela Conflitos, o botão "Resolver automaticamente" exclui a linha manual redundante (o motor não a recria). Se o botão recusar, trate como ambíguo.',
  },
  ambiguo: {
    rotulo: "Ambíguo (decisão manual)",
    significado:
      'Não é nem "duplicata em Sem Categoria" nem "revisão manual superada": são mais de 2 linhas, uma linha só, nenhuma ou 2+ linhas manuais, ' +
      "ou 2 linhas de categorias divergentes em que nenhuma é claramente a duplicata. O sistema não escolhe sozinho qual linha está errada.",
    acao:
      'Confira os valores da fatura no Conexa e, na tela Conflitos, exclua a linha errada ("Excluir esta linha", sem desfazer). ' +
      "Se a diferença for NEGATIVA (as linhas somam menos que a fatura), não é dupla contagem: falta valor — confira a fatura antes de excluir qualquer linha.",
  },
};

/** Todas as classificações, na ordem em que aparecem nas telas e nas planilhas. */
export const CLASSIFICACOES: readonly ClassificacaoTipo[] = Object.keys(INFO_CLASSIFICACAO) as ClassificacaoTipo[];

/** Valor desconhecido aparece como veio (nunca some nem derruba a planilha): a conferência é quem o acusa. */
export const rotuloClassificacao = (t: ClassificacaoTipo): string => INFO_CLASSIFICACAO[t]?.rotulo ?? String(t);

// ---------------------------------------------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------------------------------------------

export interface PedidoConflitos {
  /** Classificações pedidas, na ordem do catálogo. Vazio = todas (as três juntas equivalem a nenhum filtro e viram vazio). */
  classificacoes: ClassificacaoTipo[];
  /** Incluir as abas "Por fatura" e "Por classificação". */
  resumos: boolean;
}

export function lerPedidoConflitos(params: ParamsBrutos): { pedido: PedidoConflitos; erros: string[] } {
  const erros: string[] = [];
  const enviado = um(params.f) !== "";
  validarParametros(params, ["f", "resumos"], erros);

  const pedidas = lista(params.classificacao, 20, 40);
  const conhecidas = new Set<string>(CLASSIFICACOES);
  const invalidas = pedidas.filter((c) => !conhecidas.has(c));
  if (invalidas.length) {
    erros.push(`Classificação desconhecida: ${invalidas.map((c) => `"${c.slice(0, 20)}"`).join(", ")} (use ${CLASSIFICACOES.join(", ")}).`);
  }
  let classificacoes = CLASSIFICACOES.filter((c) => pedidas.includes(c));
  if (classificacoes.length === CLASSIFICACOES.length) classificacoes = [];

  const resumos = lerSimNao(params, "resumos", "Abas de resumo", false, enviado, erros);
  return { pedido: { classificacoes, resumos }, erros };
}

export function descreverPedidoConflitos(p: PedidoConflitos): Array<[string, string]> {
  return [
    ["Classificação", p.classificacoes.length ? p.classificacoes.map(rotuloClassificacao).join("; ") : `todas (${CLASSIFICACOES.map(rotuloClassificacao).join("; ")})`],
    ["Meses de crédito", "todos (a lista não é recortada por período)"],
  ];
}

export function nomeDoArquivoConflitos(p: PedidoConflitos, hojeIso: string, extensao = "xlsx"): string {
  return `Conflitos_${hojeIso}${p.classificacoes.length ? "_filtrado" : ""}.${extensao}`;
}

/** A mesma lista da tela, restrita às classificações pedidas (vazio = sem restrição). */
export function filtrarPorClassificacao<C extends { classificacao: { tipo: ClassificacaoTipo } }>(conflitos: readonly C[], classificacoes: readonly ClassificacaoTipo[]): C[] {
  if (classificacoes.length === 0) return [...conflitos];
  return conflitos.filter((c) => classificacoes.includes(c.classificacao.tipo));
}

// ---------------------------------------------------------------------------------------------------------------
// Permissão e tamanho
// ---------------------------------------------------------------------------------------------------------------

/**
 * Só administrador. A tela de origem (/conflitos) também é, e a lista traz nome de cliente e de quem revisou cada linha.
 * É a SEGUNDA checagem (o despachante já confere `somenteAdmin`): defesa em profundidade, sem depender de quem chama.
 */
export function validarPermissoesConflitos(usuario: UsuarioExport): void {
  if (usuario.papel !== "ADMIN") {
    throw new ExportacaoNegadaError("A lista de conflitos só pode ser exportada por administradores (a tela Conflitos também é restrita).");
  }
}

/** Quantas linhas a aba principal terá: uma por linha de cada conflito. */
export const contarLinhasDosConflitos = (conflitos: ReadonlyArray<{ linhas: readonly unknown[] }>): number => conflitos.reduce((n, c) => n + c.linhas.length, 0);

export function exigirTamanhoSuportado(nLinhas: number, nConflitos: number): void {
  if (nLinhas > MAX_LINHAS) {
    throw new ExportacaoGrandeDemaisError(
      `Os conflitos pedidos somam ${nLinhas.toLocaleString("pt-BR")} linhas (${nConflitos.toLocaleString("pt-BR")} conflitos) e o máximo por exportação é ${MAX_LINHAS.toLocaleString("pt-BR")}. ` +
        "Peça uma classificação por vez (filtro Classificação) ou resolva conflitos na tela Conflitos antes de exportar.",
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Entrada: o que `listarConflitos()` devolve, mais o que a SEGUNDA leitura (por id) acrescenta
// ---------------------------------------------------------------------------------------------------------------

/**
 * A forma de `FaturaConflito` (conflitos.ts). Declarada aqui para a parte pura não depender do módulo do servidor
 * (`server-only`); o compilador garante a compatibilidade, porque o servidor passa o resultado de `listarConflitos()`
 * direto para estas funções.
 */
export interface ConflitoDeEntrada {
  crConexaId: number;
  razaoSocial: string | null;
  /** O valor de UMA parcela da fatura. */
  valorRecebidoTotal: string;
  somaAtual: string;
  diferenca: string;
  linhas: LinhaConflito[];
  classificacao: ClassificacaoConflito;
}

/** O que o banco diz de uma linha na SEGUNDA leitura (`LinhaConflito` não traz o mês nem a data de crédito). */
export interface LinhaDoBanco {
  crConexaId: number;
  chaveLinha: string;
  mesCredito: string;
  dataCredito: Date | null;
  valorRecebidoCat: string;
}

/** Segunda leitura, feita numa única transação: as linhas por id e, DO BANCO, a contagem e a soma dos mesmos ids. */
export interface LeituraDoBanco {
  porId: Map<string, LinhaDoBanco>;
  contagem: number;
  /** Soma de valorRecebidoCat dos ids pedidos, calculada pelo banco ("1234.56"). */
  total: string;
}

export interface LinhaParaExportar extends LinhaConflito {
  /** Meia-noite UTC (coluna `@db.Date`). */
  dataCredito: Date | null;
}

export interface ConflitoParaExportar extends Omit<ConflitoDeEntrada, "linhas"> {
  /** "aaaa-mm": o mês de crédito do conflito (todas as linhas dele são do mesmo mês). */
  mesCredito: string;
  linhas: LinhaParaExportar[];
}

const MAX_PROBLEMAS_NA_MENSAGEM = 8;

/** As primeiras divergências, e quantas ficaram de fora: a mensagem de erro precisa caber numa tela. */
export function resumirProblemas(problemas: readonly string[]): string {
  const mostradas = problemas.slice(0, MAX_PROBLEMAS_NA_MENSAGEM).join("; ");
  const resto = problemas.length - MAX_PROBLEMAS_NA_MENSAGEM;
  return resto > 0 ? `${mostradas}; (+${resto} divergência(s))` : mostradas;
}

/**
 * Casa cada linha da lista com o que o banco diz dela AGORA e confere a segunda leitura (ADR-0035).
 *
 * `listarConflitos()` e a leitura por id são duas consultas, não uma transação só: entre elas uma sincronização ou uma
 * resolução pela tela pode apagar, trocar a chave ou mudar o valor de uma linha. Isto é detectado aqui — e vira erro
 * ("tente de novo"), nunca uma planilha com mês de uma linha e valor de outra. Devolve também a contagem e a soma do
 * BANCO contra as das linhas (a conferência de dinheiro contra o banco).
 */
export function juntarComBanco(conflitos: readonly ConflitoDeEntrada[], leitura: LeituraDoBanco): { conflitos: ConflitoParaExportar[]; problemas: string[] } {
  const problemas: string[] = [];
  const saida: ConflitoParaExportar[] = [];
  let nLinhas = 0;
  let somaLinhas = ZERO;

  for (const c of conflitos) {
    const onde = `fatura ${c.crConexaId}`;
    const meses = new Set<string>();
    const linhas: LinhaParaExportar[] = [];
    if (c.linhas.length === 0) problemas.push(`${onde}: conflito sem nenhuma linha`);
    for (const l of c.linhas) {
      nLinhas += 1;
      somaLinhas = somaLinhas.plus(money(l.valorRecebidoCat));
      const b = leitura.porId.get(l.id);
      if (!b) {
        problemas.push(`${onde}: a linha ${l.id} não está mais no banco (apagada depois da leitura dos conflitos)`);
        continue;
      }
      if (b.crConexaId !== c.crConexaId) problemas.push(`${onde}: a linha ${l.id} agora é da fatura ${b.crConexaId}`);
      if (b.chaveLinha !== l.chaveLinha) problemas.push(`${onde}: a chave da linha ${l.id} mudou ("${l.chaveLinha}" → "${b.chaveLinha}")`);
      if (toAmountString(money(b.valorRecebidoCat)) !== toAmountString(money(l.valorRecebidoCat))) {
        problemas.push(`${onde}: o valor da linha ${l.id} mudou (${toAmountString(money(l.valorRecebidoCat))} → ${toAmountString(money(b.valorRecebidoCat))})`);
      }
      meses.add(b.mesCredito);
      linhas.push({ ...l, dataCredito: b.dataCredito });
    }
    // Todas as linhas de um conflito são do mesmo mês de crédito (é a chave do agrupamento de `listarConflitos`).
    if (meses.size > 1) problemas.push(`${onde}: as linhas estão em meses de crédito diferentes (${[...meses].sort().join(", ")})`);
    saida.push({ ...c, mesCredito: [...meses][0] ?? "", linhas });
  }

  // Contra o BANCO: quantas linhas existem para os ids lidos, e quanto elas somam (SUM do Postgres, não do JavaScript).
  if (leitura.contagem !== nLinhas) problemas.push(`o banco tem ${leitura.contagem} linha(s) para os ${nLinhas} id(s) da lista`);
  const totalBanco = toAmountString(money(leitura.total));
  const totalLinhas = toAmountString(somaLinhas);
  if (totalBanco !== totalLinhas) problemas.push(`a soma do banco (${totalBanco}) ≠ a soma das linhas da lista (${totalLinhas})`);

  return { conflitos: saida, problemas };
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência dos próprios conflitos (as invariantes de `listarConflitos`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * O que tem de ser verdade em QUALQUER lista de conflitos (vazia = ok):
 *  - as linhas de cada conflito somam EXATAMENTE a "soma atual" dele; a diferença é soma atual − valor da fatura;
 *  - a soma de "Valor Cat." de todas as linhas é IGUAL à soma das "soma atual" de todos os conflitos;
 *  - nenhuma linha aparece em dois conflitos (contaria duas vezes) e nenhum conflito está sem linhas;
 *  - a classificação corresponde às linhas que saem na planilha (mesmo classificador da tela).
 */
export function conferirConflitos(conflitos: readonly ConflitoDeEntrada[]): string[] {
  const problemas: string[] = [];
  const vistas = new Set<string>();
  let somaDasLinhas = ZERO;
  let somaAtualDosConflitos = ZERO;

  for (const c of conflitos) {
    const onde = `fatura ${c.crConexaId}`;
    if (c.linhas.length === 0) problemas.push(`${onde}: conflito sem nenhuma linha`);
    for (const l of c.linhas) {
      if (vistas.has(l.id)) problemas.push(`${onde}: a linha ${l.id} aparece em mais de um conflito`);
      vistas.add(l.id);
    }

    const dasLinhas = sum(c.linhas.map((l) => l.valorRecebidoCat));
    const somaAtual = money(c.somaAtual);
    if (!dasLinhas.equals(somaAtual)) problemas.push(`${onde}: as linhas somam ${toAmountString(dasLinhas)}, mas a lista informa soma atual ${toAmountString(somaAtual)}`);

    const dif = somaAtual.minus(money(c.valorRecebidoTotal));
    if (!dif.equals(money(c.diferenca))) problemas.push(`${onde}: a diferença ${c.diferenca} ≠ soma atual − valor da fatura (${toAmountString(dif)})`);

    if (!(c.classificacao.tipo in INFO_CLASSIFICACAO)) {
      problemas.push(`${onde}: classificação desconhecida ("${String(c.classificacao.tipo).slice(0, 40)}")`);
    } else {
      const recalculada = classificarConflito(c.linhas).tipo;
      if (recalculada !== c.classificacao.tipo) problemas.push(`${onde}: a classificação "${c.classificacao.tipo}" não corresponde às linhas (o classificador diz "${recalculada}")`);
    }

    somaDasLinhas = somaDasLinhas.plus(dasLinhas);
    somaAtualDosConflitos = somaAtualDosConflitos.plus(somaAtual);
  }

  if (!somaDasLinhas.equals(somaAtualDosConflitos)) {
    problemas.push(`a soma de Valor Cat. das linhas (${toAmountString(somaDasLinhas)}) ≠ a soma das "soma atual" dos conflitos (${toAmountString(somaAtualDosConflitos)})`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------
// Resumo (usado pela planilha e pela prévia da tela: o mesmo cálculo nos dois)
// ---------------------------------------------------------------------------------------------------------------

export interface ResumoClassificacao {
  conflitos: number;
  linhas: number;
  /** Σ |diferença|. */
  somaAbsDiferenca: Money;
}

export interface ResumoConflitos {
  /** Conflitos = pares (fatura, mês de crédito). */
  conflitos: number;
  /** Faturas DISTINTAS (uma fatura com conflito em dois meses conta uma vez). */
  faturas: number;
  linhas: number;
  /** Σ "soma atual" dos conflitos — é também a soma de "Valor Cat." das linhas. */
  somaAtual: Money;
  /** Σ valor da fatura (uma parcela por conflito). */
  valorDasFaturas: Money;
  /** Soma das diferenças POSITIVAS: linhas somando mais que a fatura (possível dupla contagem). */
  excesso: Money;
  conflitosComExcesso: number;
  /** Soma das diferenças NEGATIVAS em valor absoluto: linhas somando menos que a fatura. */
  falta: Money;
  conflitosComFalta: number;
  /** Σ |diferença| = excesso + falta. */
  somaAbsDiferenca: Money;
  porClassificacao: Record<ClassificacaoTipo, ResumoClassificacao>;
}

export function resumirConflitos(conflitos: readonly ConflitoDeEntrada[]): ResumoConflitos {
  const porClassificacao = {} as Record<ClassificacaoTipo, ResumoClassificacao>;
  for (const t of CLASSIFICACOES) porClassificacao[t] = { conflitos: 0, linhas: 0, somaAbsDiferenca: ZERO };

  let linhas = 0;
  let somaAtual = ZERO;
  let valorDasFaturas = ZERO;
  let excesso = ZERO;
  let falta = ZERO;
  let conflitosComExcesso = 0;
  let conflitosComFalta = 0;

  for (const c of conflitos) {
    const dif = money(c.diferenca);
    linhas += c.linhas.length;
    somaAtual = somaAtual.plus(money(c.somaAtual));
    valorDasFaturas = valorDasFaturas.plus(money(c.valorRecebidoTotal));
    // `gt`/`lt` (não `isPositive`): o zero do decimal.js tem sinal e `isPositive()` o aceitaria como excesso.
    if (dif.gt(0)) {
      excesso = excesso.plus(dif);
      conflitosComExcesso += 1;
    } else if (dif.lt(0)) {
      falta = falta.plus(dif.abs());
      conflitosComFalta += 1;
    }
    const grupo = porClassificacao[c.classificacao.tipo];
    grupo.conflitos += 1;
    grupo.linhas += c.linhas.length;
    grupo.somaAbsDiferenca = grupo.somaAbsDiferenca.plus(dif.abs());
  }

  return {
    conflitos: conflitos.length,
    faturas: new Set(conflitos.map((c) => c.crConexaId)).size,
    linhas,
    somaAtual,
    valorDasFaturas,
    excesso,
    conflitosComExcesso,
    falta,
    conflitosComFalta,
    somaAbsDiferenca: excesso.plus(falta),
    porClassificacao,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Aba principal: uma linha por LINHA de cada conflito
// ---------------------------------------------------------------------------------------------------------------

/** Uma linha da aba principal: a linha do conflito mais o que é do conflito inteiro (que se repete). */
export interface LinhaDoDetalhe {
  crConexaId: number;
  mesCredito: string;
  dataCredito: Date | null;
  cliente: string | null;
  valorFatura: string;
  somaAtual: string;
  diferenca: string;
  classificacao: ClassificacaoTipo;
  categoria: string;
  servicoOuPlano: string;
  valorCat: string;
  revisadoManualmente: boolean;
  revisadoPor: string | null;
  /** Relógio de parede no fuso do app (o Excel não tem fuso). */
  revisadoEm: Date | null;
  categoriaOriginal: string | null;
  valorCatOriginal: string | null;
  chaveLinha: string;
  idLinha: string;
}

export const ABA_DETALHE_CONFLITOS = "Conflitos";
export const ABA_POR_FATURA = "Por fatura";
export const ABA_POR_CLASSIFICACAO = "Por classificação";

const NAO_SOMAR = " — do conflito, NÃO somar";

/** Em ORDEM de exibição. Só `Valor Cat.` soma. */
export const COLUNAS_CONFLITOS: ColunaDef<LinhaDoDetalhe>[] = [
  { id: "idFatura", titulo: "ID Fatura", grupo: "essenciais", tipo: "id", largura: 11, valor: (l) => l.crConexaId, campos: ["crConexaId"] },
  { id: "mesCredito", titulo: "Mês de crédito", grupo: "essenciais", tipo: "texto", largura: 12, valor: (l) => l.mesCredito, campos: ["mesCredito"] },
  { id: "dataCredito", titulo: "Data de crédito", grupo: "essenciais", tipo: "data", largura: 13, valor: (l) => l.dataCredito, campos: ["dataCredito"] },
  { id: "cliente", titulo: "Cliente", grupo: "essenciais", tipo: "texto", largura: 38, valor: (l) => l.cliente, campos: ["cliente"] },
  { id: "valorFatura", titulo: `Valor da fatura (uma parcela)${NAO_SOMAR}`, grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.valorFatura, campos: ["valorFatura"] },
  { id: "somaAtual", titulo: `Soma atual das linhas do mês${NAO_SOMAR}`, grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.somaAtual, campos: ["somaAtual"] },
  { id: "diferenca", titulo: `Diferença (soma − fatura)${NAO_SOMAR}`, grupo: "essenciais", tipo: "dinheiro", largura: 22, valor: (l) => l.diferenca, campos: ["diferenca"] },
  { id: "classificacao", titulo: "Classificação", grupo: "essenciais", tipo: "texto", largura: 28, valor: (l) => rotuloClassificacao(l.classificacao), campos: ["classificacao"] },
  { id: "codigoClassificacao", titulo: "Código da classificação", grupo: "essenciais", tipo: "texto", largura: 24, valor: (l) => l.classificacao, campos: ["classificacao"] },
  { id: "categoria", titulo: "Categoria da linha", grupo: "essenciais", tipo: "texto", largura: 36, valor: (l) => l.categoria, campos: ["categoria"] },
  { id: "servicoOuPlano", titulo: "Serviço/Plano", grupo: "essenciais", tipo: "texto", largura: 46, valor: (l) => l.servicoOuPlano, campos: ["servicoOuPlano"] },
  { id: "valorCat", titulo: "Valor Cat.", grupo: "essenciais", tipo: "dinheiro", largura: 14, valor: (l) => l.valorCat, campos: ["valorCat"] },
  { id: "revisada", titulo: "Revisada manualmente", grupo: "essenciais", tipo: "texto", largura: 14, valor: (l) => (l.revisadoManualmente ? "Sim" : "Não"), campos: ["revisadoManualmente"] },
  { id: "revisadaPor", titulo: "Revisada por", grupo: "essenciais", tipo: "texto", largura: 24, valor: (l) => l.revisadoPor, campos: ["revisadoPor"] },
  { id: "revisadaEm", titulo: "Revisada em", grupo: "essenciais", tipo: "datahora", largura: 17, valor: (l) => l.revisadoEm, campos: ["revisadoEm"] },
  { id: "categoriaOriginal", titulo: "Categoria original", grupo: "essenciais", tipo: "texto", largura: 34, valor: (l) => l.categoriaOriginal, campos: ["categoriaOriginal"] },
  { id: "valorCatOriginal", titulo: "Valor Cat. original", grupo: "essenciais", tipo: "dinheiro", largura: 18, valor: (l) => l.valorCatOriginal, campos: ["valorCatOriginal"] },
  { id: "chaveLinha", titulo: "Chave da linha", grupo: "essenciais", tipo: "texto", largura: 40, valor: (l) => l.chaveLinha, campos: ["chaveLinha"] },
  { id: "idLinha", titulo: "ID interno da linha", grupo: "essenciais", tipo: "texto", largura: 28, valor: (l) => l.idLinha, campos: ["idLinha"] },
];

/** Id da coluna cuja soma é "o valor da exportação". */
export const COLUNA_VALOR_CONFLITOS = "valorCat";
export const TITULOS_COLUNAS_CONFLITOS: string[] = COLUNAS_CONFLITOS.map((c) => c.titulo);

/**
 * A ordem da tela: maior diferença (com sinal) primeiro. `listarConflitos` ordena só pela diferença, e o Postgres não
 * garante a ordem dos empates — aqui o desempate é fixo (fatura, mês), então duas exportações iguais saem iguais.
 */
export function ordenarConflitos<C extends { crConexaId: number; mesCredito: string; diferenca: string }>(conflitos: readonly C[]): C[] {
  return [...conflitos].sort((a, b) => money(b.diferenca).comparedTo(money(a.diferenca)) || a.crConexaId - b.crConexaId || (a.mesCredito < b.mesCredito ? -1 : a.mesCredito > b.mesCredito ? 1 : 0));
}

/** Data de revisão (ISO, vinda de `LinhaConflito`) → relógio de parede. Data ilegível é ERRO: sumir em branco esconderia o defeito. */
function revisadoEmDeParede(iso: string | null, onde: string): Date | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new ExportacaoInconsistenteError(`${onde}: a data de revisão "${iso.slice(0, 30)}" não é uma data válida — o arquivo não foi entregue.`);
  }
  return paraParede(d);
}

export function linhasDoDetalhe(conflitos: readonly ConflitoParaExportar[]): LinhaDoDetalhe[] {
  return conflitos.flatMap((c) =>
    c.linhas.map((l) => ({
      crConexaId: c.crConexaId,
      mesCredito: c.mesCredito,
      dataCredito: l.dataCredito,
      cliente: c.razaoSocial,
      valorFatura: c.valorRecebidoTotal,
      somaAtual: c.somaAtual,
      diferenca: c.diferenca,
      classificacao: c.classificacao.tipo,
      categoria: l.categoria,
      servicoOuPlano: l.servicoOuPlano,
      valorCat: l.valorRecebidoCat,
      revisadoManualmente: l.revisadoManualmente,
      revisadoPor: l.revisadoPorNome,
      revisadoEm: revisadoEmDeParede(l.revisadoEm, `fatura ${c.crConexaId}, linha ${l.id}`),
      categoriaOriginal: l.categoriaOriginal,
      valorCatOriginal: l.valorRecebidoCatOriginal,
      chaveLinha: l.chaveLinha,
      idLinha: l.id,
    })),
  );
}

/**
 * A aba principal, JÁ MONTADA, fecha com a lista (vazia = ok): a soma da coluna "Valor Cat." (calculada pelo gerador,
 * linha a linha, em decimal) tem de ser IGUAL à soma das "soma atual" de todos os conflitos, e o número de linhas de
 * dados da aba, a soma dos tamanhos de `.linhas`. É a invariante de `listarConflitos`, conferida contra o que
 * efetivamente foi para a aba — não contra os mesmos números de onde ela saiu.
 */
export function conferirDetalhe(detalhe: Pick<Detalhe, "total" | "ultimaLinhaDados">, conflitos: readonly ConflitoDeEntrada[]): string[] {
  const problemas: string[] = [];
  const esperada = toAmountString(sum(conflitos.map((c) => c.somaAtual)));
  if (detalhe.total !== esperada) {
    problemas.push(`aba ${ABA_DETALHE_CONFLITOS}: soma de Valor Cat. (${detalhe.total}) ≠ soma das "soma atual" dos conflitos (${esperada})`);
  }
  const linhasNaAba = detalhe.ultimaLinhaDados - 1;
  const linhasEsperadas = contarLinhasDosConflitos(conflitos);
  if (linhasNaAba !== linhasEsperadas) {
    problemas.push(`aba ${ABA_DETALHE_CONFLITOS}: ${linhasNaAba} linha(s) de dados, os conflitos têm ${linhasEsperadas}`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------
// Montagem das abas
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaPastaConflitos {
  conflitos: ConflitoParaExportar[];
  /** Quantos conflitos existem no banco ANTES do filtro de classificação (contexto para o Leia-me). */
  totalSemFiltro: number;
  pedido: PedidoConflitos;
  geradoEm: Date;
  usuario: UsuarioExport;
  /** Frase pronta sobre a atualidade dos dados. */
  frescor: { texto: string; alerta: boolean };
}

export interface SaidaPastaConflitos {
  abas: Sheet[];
  detalhe: Detalhe;
  /** Soma exata de "Valor Cat." (= soma das "soma atual" dos conflitos). */
  total: Money;
  nLinhas: number;
  nConflitos: number;
  titulosDasColunas: string[];
  resumo: ResumoConflitos;
  /** O que o arquivo lido de volta tem de mostrar, aba por aba (vai direto para `entregar`). */
  esperado: EsperadoNaAba[];
}

const colunasPorFatura: ColunaTabela[] = [
  { titulo: "ID Fatura", tipo: "id", largura: 11 },
  { titulo: "Mês de crédito", tipo: "texto", largura: 12 },
  { titulo: "Cliente", tipo: "texto", largura: 38 },
  { titulo: "Valor da fatura (uma parcela)", tipo: "dinheiro", largura: 20 },
  { titulo: "Soma atual das linhas do mês", tipo: "dinheiro", largura: 20 },
  { titulo: "Diferença (soma − fatura)", tipo: "dinheiro", largura: 18 },
  { titulo: "Classificação", tipo: "texto", largura: 28 },
  { titulo: "Código da classificação", tipo: "texto", largura: 24 },
  { titulo: "Nº de linhas", tipo: "inteiro", largura: 10 },
  { titulo: "Explicação", tipo: "texto", largura: 90 },
];
/** Índice (0-based) da coluna que a leitura de volta soma em "Por fatura". */
const INDICE_SOMA_ATUAL = 4;

const colunasPorClassificacao: ColunaTabela[] = [
  { titulo: "Classificação", tipo: "texto", largura: 30 },
  { titulo: "Código", tipo: "texto", largura: 26 },
  { titulo: "Faturas em conflito", tipo: "inteiro", largura: 20 },
  { titulo: "Linhas", tipo: "inteiro", largura: 10 },
  { titulo: "Soma de |diferença|", tipo: "dinheiro", largura: 20 },
];
const INDICE_SOMA_ABS = 4;

const nPt = (n: number): string => n.toLocaleString("pt-BR");

export function montarAbasConflitos(e: EntradaPastaConflitos): SaidaPastaConflitos {
  const conflitos = ordenarConflitos(e.conflitos);

  // 1) A lista se sustenta? (somas das linhas, diferenças, classificações, linhas repetidas). Defeito = erro, não arquivo.
  const defeitos = conferirConflitos(conflitos);
  if (defeitos.length) {
    throw new ExportacaoInconsistenteError(`A conferência interna dos conflitos não fechou — o arquivo não foi entregue. ${resumirProblemas(defeitos)}.`);
  }

  const resumo = resumirConflitos(conflitos);
  const linhas = linhasDoDetalhe(conflitos);
  const detalhe = abaDeDetalhe({ nome: ABA_DETALHE_CONFLITOS, colunas: COLUNAS_CONFLITOS, linhas, colunaTotal: COLUNA_VALOR_CONFLITOS });
  const somaAtualStr = toAmountString(resumo.somaAtual);

  // 2) O que ficou NA ABA fecha com a lista? (ver `conferirDetalhe`) E a lista é coerente com o pedido?
  const divergencias: string[] = [];
  const foraDoPedido = e.pedido.classificacoes.length ? conflitos.filter((c) => !e.pedido.classificacoes.includes(c.classificacao.tipo)).length : 0;
  if (foraDoPedido) divergencias.push(`${foraDoPedido} conflito(s) de classificação que o pedido não incluiu`);
  divergencias.push(...conferirDetalhe(detalhe, conflitos));
  if (divergencias.length) {
    throw new ExportacaoInconsistenteError(`A conferência interna não fechou — o arquivo não foi entregue. ${resumirProblemas(divergencias)}.`);
  }

  const abas: Sheet[] = [];
  const esperado: EsperadoNaAba[] = [{ nomeAba: ABA_DETALHE_CONFLITOS, titulos: TITULOS_COLUNAS_CONFLITOS, nLinhas: linhas.length, indiceValor: detalhe.indiceColunaTotal, total: somaAtualStr }];

  if (e.pedido.resumos) {
    // --- Por fatura: uma linha por conflito -------------------------------------------------------------------------
    abas.push(
      abaDeTabela({
        nome: ABA_POR_FATURA,
        colunas: colunasPorFatura,
        linhas: conflitos.map((c) => [
          c.crConexaId,
          c.mesCredito,
          c.razaoSocial,
          c.valorRecebidoTotal,
          c.somaAtual,
          c.diferenca,
          rotuloClassificacao(c.classificacao.tipo),
          c.classificacao.tipo,
          c.linhas.length,
          c.classificacao.explicacao,
        ]),
        total: ["TOTAL", null, null, toAmountString(resumo.valorDasFaturas), somaAtualStr, toAmountString(resumo.somaAtual.minus(resumo.valorDasFaturas)), null, null, resumo.linhas, null],
        nota: "Uma linha por conflito (fatura × mês de crédito). Diferença = soma atual − valor da fatura: positiva = linhas a MAIS (possível dupla contagem); negativa = linhas a MENOS (falta de valor).",
      }),
    );
    esperado.push({ nomeAba: ABA_POR_FATURA, titulos: colunasPorFatura.map((c) => c.titulo), nLinhas: conflitos.length, indiceValor: INDICE_SOMA_ATUAL, total: somaAtualStr });

    // --- Por classificação -------------------------------------------------------------------------------------------
    const incluidas = e.pedido.classificacoes.length ? e.pedido.classificacoes : CLASSIFICACOES;
    abas.push(
      abaDeTabela({
        nome: ABA_POR_CLASSIFICACAO,
        colunas: colunasPorClassificacao,
        linhas: incluidas.map((t) => {
          const g = resumo.porClassificacao[t];
          return [rotuloClassificacao(t), t, g.conflitos, g.linhas, toAmountString(g.somaAbsDiferenca)];
        }),
        total: ["TOTAL", null, resumo.conflitos, resumo.linhas, toAmountString(resumo.somaAbsDiferenca)],
        nota: "Conta cada fatura uma vez por mês de crédito em conflito: uma fatura com conflito em dois meses conta duas vezes. A soma de |diferença| ignora o sinal (excesso e falta somam).",
        autoFiltro: false,
      }),
    );
    esperado.push({ nomeAba: ABA_POR_CLASSIFICACAO, titulos: colunasPorClassificacao.map((c) => c.titulo), nLinhas: incluidas.length, indiceValor: INDICE_SOMA_ABS, total: toAmountString(resumo.somaAbsDiferenca) });
  }

  // --- Leia-me ----------------------------------------------------------------------------------------------------------
  const filtrado = e.pedido.classificacoes.length > 0;
  const avisos: string[] = [
    "Esta lista reflete o ESTADO ATUAL do banco no momento da exportação: é a mesma da tela Conflitos, calculada na hora sobre todas as linhas de receita, e não o retrato de uma rodada de sincronização. " +
      "Um conflito resolvido depois some da lista; a cada sincronização podem surgir outros.",
    "Um conflito é uma fatura, num mês de crédito, cujas linhas NÃO somam o valor da fatura (acima da tolerância de centavos da tela). Uma fatura com problema em dois meses aparece em dois conflitos.",
    "O valor da fatura é o de UMA parcela (valorRecebidoTotal): o Conexa exporta uma parcela por cobrança, então cada mês de crédito é conferido contra o valor de uma parcela.",
    "Diferença = soma atual das linhas − valor da fatura. POSITIVA: as linhas somam MAIS que a fatura (possível dupla contagem). NEGATIVA: somam MENOS (falta de valor; não é dupla contagem).",
    `Some SOMENTE a coluna "Valor Cat." da aba ${ABA_DETALHE_CONFLITOS} (valor da linha). "Valor da fatura", "Soma atual" e "Diferença" são do conflito inteiro e se repetem em cada linha dele: somá-los conta o mesmo dinheiro mais de uma vez.` +
      (e.pedido.resumos ? ` A aba "${ABA_POR_FATURA}" tem uma linha por conflito.` : ""),
    ...CLASSIFICACOES.map((t) => `${INFO_CLASSIFICACAO[t].rotulo} — código "${t}". ${INFO_CLASSIFICACAO[t].significado} O que fazer: ${INFO_CLASSIFICACAO[t].acao}`),
    'Linha revisada manualmente (Revisada manualmente = Sim) tem categoria e valor CONGELADOS: a sincronização não os sobrescreve. A categoria e o valor que a skill calculou ficam em "Categoria original" e "Valor Cat. original".',
    "Categorias, serviços/planos e chaves saem com a grafia EXATA do banco (inclusive espaços duplos, que são reais): não os normalize ao procurar.",
    "Esta planilha só LÊ: nada é alterado no sistema. Resolver um conflito é feito na tela Conflitos (somente administrador).",
  ];

  const leiaMe = abaLeiaMe({
    titulo: "Exportação de conflitos (possível dupla contagem) — Seahub Financeiro",
    geradoEm: e.geradoEm,
    geradoPor: textoSeguro(`${e.usuario.nome} (${e.usuario.email})`),
    filtros: descreverPedidoConflitos(e.pedido),
    resultado: [
      ["Conflitos exportados (fatura × mês de crédito)", `${nPt(resumo.conflitos)} de ${nPt(e.totalSemFiltro)} em aberto${filtrado ? " (filtrado por classificação)" : ""}`],
      ["Faturas distintas", nPt(resumo.faturas)],
      [`Linhas na aba ${ABA_DETALHE_CONFLITOS}`, nPt(resumo.linhas)],
      ["Soma das linhas (Valor Cat.)", formatBRL(resumo.somaAtual)],
      ["Excesso (linhas somam mais que a fatura)", `${formatBRL(resumo.excesso)} em ${nPt(resumo.conflitosComExcesso)} conflito(s)`],
      ["Falta (linhas somam menos que a fatura)", `${formatBRL(resumo.falta)} em ${nPt(resumo.conflitosComFalta)} conflito(s)`],
      ["Por classificação", (e.pedido.classificacoes.length ? e.pedido.classificacoes : CLASSIFICACOES).map((t) => `${rotuloClassificacao(t)}: ${nPt(resumo.porClassificacao[t].conflitos)}`).join(" · ")],
      [`Colunas da aba ${ABA_DETALHE_CONFLITOS}`, TITULOS_COLUNAS_CONFLITOS.join(" · ")],
    ],
    frescor: e.frescor,
    avisos,
    conferencia:
      `OK. A soma de "Valor Cat." (${formatBRL(resumo.somaAtual)}) é igual à soma das "soma atual" dos ${nPt(resumo.conflitos)} conflito(s) e a contagem de linhas (${nPt(resumo.linhas)}) fecha com a dos conflitos; ` +
      "as linhas foram conferidas contra o banco (mês de crédito, valor e soma) e o arquivo foi lido de volta, aba por aba, antes de entregar.",
  });

  return {
    abas: [detalhe.aba, ...abas, leiaMe],
    detalhe,
    total: resumo.somaAtual,
    nLinhas: linhas.length,
    nConflitos: conflitos.length,
    titulosDasColunas: TITULOS_COLUNAS_CONFLITOS,
    resumo,
    esperado,
  };
}
