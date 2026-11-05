import "server-only";
import { Prisma, type ClickUpVinculo } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/dates";
import { composicaoDoVinculo } from "@/lib/clickup/composicao";
import { PadroesVazioError } from "@/lib/clickup/filtro-padroes";
import { limitesDoMes } from "@/lib/clickup/periodo-corrente";
import { money, toAmountString } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { ceder } from "./fila";
import { frescorDaReceita } from "./frescor";
import {
  assinaturaDosVinculos,
  conferirContraBancoClickUp,
  descreverPedidoClickUp,
  erroDeCategoriasDesconhecidas,
  exigirAdministrador,
  impressoesIguais,
  montarAbasClickUp,
  nomeDoArquivoClickUp,
  NOME_ABA_PRINCIPAL,
  type ComposicaoExportada,
  type EnvioClickUp,
  type ImpressaoDasLinhas,
  type LinhaDoBanco,
  type PedidoClickUp,
  type VinculoClickUp,
} from "./pasta-clickup";
import { paraParede } from "./planilha";
import {
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoInvalidaError,
  MAX_LINHAS,
  type Formato,
  type ResultadoExportacao,
  type UsuarioExport,
} from "./tipos";

/**
 * Exportação do ESPELHO DO CLICKUP (ADR-0035), parte do servidor. Só LEITURA: nunca chama o ClickUp nem o push (não
 * importa `push.ts` nem o cliente HTTP), nunca escreve em vínculo, envio ou receita.
 *
 * A COMPOSIÇÃO vem de `composicaoDoVinculo` — a mesma função do envio e da tela de detalhamento, chamada do MESMO jeito
 * (`outrosAtivosDaMesmaCategoria` = os vínculos ATIVOS da categoria, e os limites do mês de `limitesDoMes`, que o teste do
 * módulo trava igual aos de `periodoCorrente`). Como ela lê o banco por conta própria, NÃO dá para pô-la dentro da
 * transação REPEATABLE READ das outras exportações. Em troca, a leitura é VALIDADA de forma otimista:
 *
 *   1. lê os vínculos e tira a impressão digital das linhas do mês (contagem, soma e última atualização);
 *   2. calcula a composição de cada vínculo, em sequência (o mesmo processo serve o painel e a sincronização);
 *   3. numa transação REPEATABLE READ relê os vínculos, tira a impressão digital de novo, lê os envios e relê do banco
 *      as linhas que a planilha vai mostrar;
 *   4. se vínculos ou linhas mudaram entre 1 e 3 (uma sincronização de 15 min gravou no meio), refaz — até 3 vezes —
 *      em vez de entregar uma mistura de dois instantes; se as linhas relidas não batem, é erro, não arquivo.
 */

const MAX_TENTATIVAS = 3;
/** Ids por consulta ao reler as linhas (o Postgres limita o número de parâmetros de uma consulta). */
const TAM_LOTE_IDS = 5000;
/** A cada quantos vínculos devolver o controle ao event loop (cada composição é uma consulta e um monte de JSON). */
const CEDER_A_CADA = 10;

type Leitor = Pick<Prisma.TransactionClient, "revenueCategorizedLine">;

type VinculoComRelacoes = Prisma.ClickUpVinculoGetPayload<{ include: { criadoPor: { select: { name: true } }; pushes: true } }>;

const padroesValidos = (json: unknown): string[] | null => (Array.isArray(json) && json.every((p) => typeof p === "string") ? (json as string[]) : null);

/** Contagem, soma e última atualização das linhas de receita do mês nas categorias da composição. */
async function impressaoDasLinhas(db: Leitor, categorias: string[], de: Date, ateExclusivo: Date): Promise<ImpressaoDasLinhas> {
  if (categorias.length === 0) return { linhas: 0, soma: "0.00", ultimaAtualizacao: null };
  const r = await db.revenueCategorizedLine.aggregate({
    where: { categoria: { in: categorias }, dataCredito: { gte: de, lt: ateExclusivo } },
    _count: { _all: true },
    _sum: { valorRecebidoCat: true },
    _max: { atualizadoEm: true },
  });
  return {
    linhas: r._count._all,
    soma: toAmountString(money(r._sum.valorRecebidoCat?.toString() ?? "0")),
    ultimaAtualizacao: r._max.atualizadoEm ? r._max.atualizadoEm.getTime() : null,
  };
}

async function lerLinhasDoBanco(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, LinhaDoBanco>> {
  const mapa = new Map<string, LinhaDoBanco>();
  for (let i = 0; i < ids.length; i += TAM_LOTE_IDS) {
    const lote = await tx.revenueCategorizedLine.findMany({
      where: { id: { in: ids.slice(i, i + TAM_LOTE_IDS) } },
      select: { id: true, crConexaId: true, categoria: true, dataCredito: true, valorRecebidoCat: true },
    });
    for (const r of lote) {
      mapa.set(r.id, { id: r.id, crConexaId: r.crConexaId, categoria: r.categoria, dataCredito: r.dataCredito, valorRecebidoCat: r.valorRecebidoCat.toFixed(2) });
    }
  }
  return mapa;
}

function paraVinculoClickUp(v: VinculoComRelacoes): VinculoClickUp {
  const ultimo = v.pushes[0];
  return {
    id: v.id,
    categoria: v.categoria,
    padroes: padroesValidos(v.padroes) ?? [],
    clickUpTaskId: v.clickUpTaskId,
    clickUpListId: v.clickUpListId,
    ativo: v.ativo,
    criadoPorNome: v.criadoPor?.name ?? null,
    criadoEm: paraParede(v.criadoEm),
    ultimoEnvio: ultimo
      ? { vinculoId: ultimo.vinculoId, ano: ultimo.ano, mes: ultimo.mes, valor: ultimo.valorEnviado.toFixed(2), sucesso: ultimo.sucesso, erro: ultimo.erro, quando: paraParede(ultimo.enviadoEm) }
      : null,
  };
}

interface ResultadoDaComposicao {
  incluidas: ComposicaoExportada["incluidas"];
  excluidas: ComposicaoExportada["excluidas"];
  total: string | null;
  erro: string | null;
}

/**
 * Calcula a composição de cada vínculo em SEQUÊNCIA (uma consulta por vínculo: lotes paralelos disputariam o pool de
 * conexões com o painel e a sincronização). Para cedo se o recorte já passou do teto de linhas.
 */
async function comporTodos(
  paraCompor: ClickUpVinculo[],
  ativos: ClickUpVinculo[],
  de: Date,
  ateExclusivo: Date,
  formato: Formato,
): Promise<Map<string, ResultadoDaComposicao>> {
  const resultados = new Map<string, ResultadoDaComposicao>();
  let linhas = 0;
  let excluidas = 0;
  for (const [i, v] of paraCompor.entries()) {
    // A MESMA vizinhança do envio e da tela: só vínculos ATIVOS da categoria disputam linhas (inclusive para um vínculo
    // inativo, cuja composição é "o que somaria se estivesse ativo").
    const outros = ativos.filter((o) => o.id !== v.id && o.categoria === v.categoria);
    try {
      const c = await composicaoDoVinculo(v, outros, de, ateExclusivo);
      resultados.set(v.id, { incluidas: c.incluidas, excluidas: c.excluidas, total: toAmountString(c.total), erro: null });
      linhas += c.incluidas.length;
      excluidas += c.excluidas.length;
    } catch (e) {
      // Vínculo sem padrão (o próprio ou um vizinho ativo da categoria) derruba a composição de TODOS da categoria — e o
      // envio ao ClickUp falha pelo mesmo motivo. Marca o vínculo em vez de abortar a exportação inteira por causa de um.
      if (!(e instanceof PadroesVazioError)) throw e;
      const semPadrao = ativos.filter((o) => o.categoria === v.categoria && Array.isArray(o.padroes) && o.padroes.length === 0).map((o) => o.clickUpTaskId);
      resultados.set(v.id, {
        incluidas: [],
        excluidas: [],
        total: null,
        erro: `${e.message}${semPadrao.length ? ` (vínculo(s) ativo(s) sem padrão nesta categoria: ${semPadrao.join(", ")})` : ""}`,
      });
    }
    if (linhas > MAX_LINHAS) {
      throw new ExportacaoGrandeDemaisError(
        `A composição teria mais de ${MAX_LINHAS.toLocaleString("pt-BR")} linhas (o máximo por exportação). Filtre por categoria para dividir a exportação.`,
      );
    }
    // A aba Excluídas só existe no .xlsx: o CSV não paga o teto por uma aba que ele não leva.
    if (formato === "xlsx" && excluidas > MAX_LINHAS) {
      throw new ExportacaoGrandeDemaisError(
        `A aba Excluídas teria mais de ${MAX_LINHAS.toLocaleString("pt-BR")} linhas (o máximo por exportação). Filtre por categoria para dividir a exportação.`,
      );
    }
    if ((i + 1) % CEDER_A_CADA === 0) await ceder();
  }
  return resultados;
}

interface Leitura {
  /** Vínculos do recorte de categoria (ativos e inativos), no estado do instante da transação. */
  vinculos: VinculoClickUp[];
  composicoes: ComposicaoExportada[];
  envios: EnvioClickUp[];
  banco: Map<string, LinhaDoBanco>;
}

type EnvioDoBanco = Prisma.ClickUpPushLogGetPayload<{ select: { vinculoId: true; ano: true; mes: true; valorEnviado: true; sucesso: true; erro: true; enviadoEm: true } }>;

/** O que a transação de leitura devolve; `estavel` falso = o banco mudou desde o passo 1 (o resto não foi lido). */
interface LeituraNaTransacao {
  estavel: boolean;
  vinculosC: VinculoComRelacoes[];
  envios: EnvioDoBanco[];
  banco: Map<string, LinhaDoBanco>;
}

/** Os passos 1 a 4 do cabeçalho do módulo. Devolve só uma leitura consistente (ou lança). */
async function lerComposicaoConsistente(pedido: PedidoClickUp, formato: Formato, de: Date, ateExclusivo: Date): Promise<Leitura> {
  const filtroDeCategoria: Prisma.ClickUpVinculoWhereInput = pedido.categorias.length ? { categoria: { in: pedido.categorias } } : {};

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    // 1. vínculos e impressão digital das linhas, ANTES.
    const vinculosA = await prisma.clickUpVinculo.findMany({ where: filtroDeCategoria, orderBy: [{ categoria: "asc" }, { id: "asc" }] });
    const erros = erroDeCategoriasDesconhecidas(pedido, vinculosA.map((v) => v.categoria));
    if (erros.length) throw new ExportacaoInvalidaError(erros);
    const malformado = vinculosA.find((v) => padroesValidos(v.padroes) === null);
    if (malformado) {
      throw new ExportacaoInconsistenteError(
        `O vínculo ${malformado.clickUpTaskId} (${malformado.categoria}) tem os padrões gravados num formato inválido (o esperado é uma lista de textos): corrija o cadastro antes de exportar.`,
      );
    }
    const paraCompor = vinculosA.filter((v) => v.ativo || !pedido.somenteAtivos);
    const ativos = vinculosA.filter((v) => v.ativo);
    const categoriasDaComposicao = [...new Set(paraCompor.map((v) => v.categoria))];
    const antes = await impressaoDasLinhas(prisma, categoriasDaComposicao, de, ateExclusivo);
    await ceder();

    // 2. composição (a mesma função do envio ao ClickUp).
    const resultados = await comporTodos(paraCompor, ativos, de, ateExclusivo, formato);
    const idsDasLinhas = [...new Set([...resultados.values()].flatMap((r) => [...r.incluidas, ...r.excluidas].map((l) => l.id)))];
    await ceder();

    // 3. transação de leitura: tudo daqui vem do MESMO instante.
    const lido = await prisma.$transaction(
      async (tx): Promise<LeituraNaTransacao> => {
        const depois = await impressaoDasLinhas(tx, categoriasDaComposicao, de, ateExclusivo);
        const vinculosC = await tx.clickUpVinculo.findMany({
          where: filtroDeCategoria,
          orderBy: [{ categoria: "asc" }, { id: "asc" }],
          // O último envio de QUALQUER mês, como a tela Integração ClickUp (a ordem tem desempate por id).
          include: { criadoPor: { select: { name: true } }, pushes: { orderBy: [{ enviadoEm: "desc" }, { id: "desc" }], take: 1 } },
        });
        const estavel = impressoesIguais(antes, depois) && assinaturaDosVinculos(vinculosA) === assinaturaDosVinculos(vinculosC);
        if (!estavel) return { estavel, vinculosC, envios: [], banco: new Map<string, LinhaDoBanco>() };

        // A aba Envios só existe no .xlsx: o CSV nem conta nem lê o log de envios.
        let envios: EnvioDoBanco[] = [];
        if (formato === "xlsx") {
          const onde: Prisma.ClickUpPushLogWhereInput = { vinculoId: { in: vinculosC.map((v) => v.id) }, ano: pedido.ano, mes: pedido.mes };
          const nEnvios = await tx.clickUpPushLog.count({ where: onde });
          if (nEnvios > MAX_LINHAS) {
            throw new ExportacaoGrandeDemaisError(
              `A aba Envios teria ${nEnvios.toLocaleString("pt-BR")} linhas e o máximo por exportação é ${MAX_LINHAS.toLocaleString("pt-BR")}. Filtre por categoria.`,
            );
          }
          envios = await tx.clickUpPushLog.findMany({
            where: onde,
            orderBy: [{ enviadoEm: "asc" }, { id: "asc" }],
            select: { vinculoId: true, ano: true, mes: true, valorEnviado: true, sucesso: true, erro: true, enviadoEm: true },
          });
        }
        return { estavel, vinculosC, envios, banco: await lerLinhasDoBanco(tx, idsDasLinhas) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
    );

    // 4. mudou no meio? Refaz; na última tentativa, desiste com a explicação.
    if (!lido.estavel) {
      if (tentativa === MAX_TENTATIVAS) {
        throw new ExportacaoInconsistenteError(
          `A receita ou os vínculos mudaram enquanto a exportação era montada (${MAX_TENTATIVAS} tentativas) — o arquivo não foi entregue, para não misturar dois instantes. Tente de novo em alguns segundos.`,
        );
      }
      continue;
    }

    const vinculos = lido.vinculosC.map(paraVinculoClickUp);
    const porId = new Map(vinculos.map((v) => [v.id, v]));
    const composicoes: ComposicaoExportada[] = paraCompor.map((v) => {
      const vinculo = porId.get(v.id);
      const r = resultados.get(v.id);
      if (!vinculo || !r) throw new ExportacaoInconsistenteError(`O vínculo ${v.clickUpTaskId} sumiu durante a exportação — o arquivo não foi entregue. Tente de novo.`);
      return { vinculo, ...r };
    });
    const envios: EnvioClickUp[] = lido.envios.map((x) => ({
      vinculoId: x.vinculoId,
      ano: x.ano,
      mes: x.mes,
      valor: x.valorEnviado.toFixed(2),
      sucesso: x.sucesso,
      erro: x.erro,
      quando: paraParede(x.enviadoEm),
    }));
    return { vinculos, composicoes, envios, banco: lido.banco };
  }
  throw new ExportacaoInconsistenteError("Não foi possível ler uma composição consistente — o arquivo não foi entregue.");
}

export async function gerarExportacaoClickUp(pedido: PedidoClickUp, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  exigirAdministrador(usuario);
  // O pedido normalmente vem de `lerPedidoClickUp`; quem chamar por outro caminho não pode apurar um mês que não existe.
  if (!Number.isInteger(pedido.ano) || pedido.ano < 2000 || pedido.ano > 2100 || !Number.isInteger(pedido.mes) || pedido.mes < 1 || pedido.mes > 12) {
    throw new ExportacaoInvalidaError(["Ano ou mês inválido no pedido."]);
  }
  const agora = new Date();
  const { fromDate: de, toDateExclusive: ateExclusivo } = limitesDoMes(pedido.ano, pedido.mes);

  const leitura = await lerComposicaoConsistente(pedido, formato, de, ateExclusivo);
  const frescor = await frescorDaReceita(agora);

  // 1ª conferência: as linhas que a planilha vai mostrar, relidas do banco na transação de leitura, batem?
  const doBanco = conferirContraBancoClickUp(leitura.composicoes, leitura.banco, { de, ateExclusivo });
  if (doBanco.length) throw new ExportacaoInconsistenteError(`Conferência com o banco não fechou — o arquivo não foi entregue. ${doBanco.join("; ")}.`);

  const pasta = montarAbasClickUp({
    pedido,
    vinculos: leitura.vinculos,
    composicoes: leitura.composicoes,
    envios: leitura.envios,
    geradoEm: agora,
    usuario,
    frescor: { texto: frescor.texto, alerta: frescor.alerta },
    hoje: todayKey(),
    // O CSV leva só a Composição: não monta as outras abas.
    soPrincipal: formato === "csv",
  });
  await ceder();

  // 2ª conferência: o ARQUIVO escrito (xlsx ou csv), lido de volta, tem as mesmas linhas e a mesma soma?
  const total = toAmountString(pasta.total);
  const entrega = await entregarAsync(pasta.abas, pasta.esperado, formato, NOME_ABA_PRINCIPAL);

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoClickUp(pedido, entrega.extensao),
    contentType: entrega.contentType,
    linhas: pasta.linhasComposicao,
    total,
    filtros: descreverPedidoClickUp(pedido),
    dadosPessoais: false,
    filtrosJson: pedido,
  };
}
