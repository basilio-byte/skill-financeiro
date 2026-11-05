import "server-only";
import { prisma } from "@/lib/db";
import { getPeriodBounds, nowInAppTz, todayKey, type PeriodBounds } from "@/lib/dates";
import { buildMetas } from "@/lib/metas/metas";
import { money, toAmountString, ZERO } from "@/lib/money";
import { entregarAsync } from "./empacotar";
import { comReceitaEstavel } from "./estabilidade";
import { frescorDaReceita } from "./frescor";
import {
  descreverPedidoMetas,
  montarAbasMetas,
  nomeDoArquivoMetas,
  NOME_TOTAL_ESCOPOS,
  type EscopoMeta,
  type EventoMeta,
  type Granularidade,
  type LinhaMeta,
  type PedidoMetas,
} from "./pasta-metas";
import { paraParede } from "./planilha";
import { ExportacaoInvalidaError, type Formato, type ResultadoExportacao, type UsuarioExport } from "./tipos";

/**
 * Exportação de METAS (ADR-0035), parte do servidor. O realizado vem de `buildMetas` — o MESMO cálculo da tela Metas,
 * do Panorama e do MCP — chamado uma vez por mês e uma por trimestre do ano; a meta é a cadastrada. Só LEITURA.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export async function gerarExportacaoMetas(pedido: PedidoMetas, usuario: UsuarioExport, formato: Formato = "xlsx"): Promise<ResultadoExportacao> {
  const agora = new Date();
  const agoraApp = nowInAppTz();
  const hoje = todayKey();

  const escoposDb = await prisma.metaEscopo.findMany({
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: { categorias: { select: { categoria: true }, orderBy: { categoria: "asc" } } },
  });
  const slugs = new Set(escoposDb.map((e) => e.slug));
  const desconhecidos = pedido.escopos.filter((s) => !slugs.has(s));
  if (desconhecidos.length) throw new ExportacaoInvalidaError([`Escopo desconhecido: ${desconhecidos.map((s) => `"${s.slice(0, 40)}"`).join(", ")}.`]);
  const quer = (slug: string) => pedido.escopos.length === 0 || pedido.escopos.includes(slug);

  const situacao = (p: PeriodBounds): LinhaMeta["situacao"] => (p.toKey < hoje ? "encerrado" : p.fromKey > hoje ? "futuro" : "em andamento");

  const periodos: Array<{ g: Granularidade; chave: string; ref: string }> = [];
  if (pedido.granularidades.includes("MES")) for (let m = 1; m <= 12; m++) periodos.push({ g: "MES", chave: `${pedido.ano}-${pad(m)}`, ref: `${pedido.ano}-${pad(m)}-15` });
  if (pedido.granularidades.includes("TRIMESTRE")) for (let q = 1; q <= 4; q++) periodos.push({ g: "TRIMESTRE", chave: `${pedido.ano}-Q${q}`, ref: `${pedido.ano}-${pad(q * 3 - 1)}-15` });

  // A apuração faz 16 consultas independentes (12 meses + 4 trimestres) e a sincronização de 15 minutos pode gravar no
  // meio: com a receita parada (mesma contagem, soma e última atualização antes e depois) o arquivo é consistente;
  // senão refaz (até 3 vezes) em vez de misturar dois instantes.
  const linhas = await comReceitaEstavel(async () => {
    const linhas: LinhaMeta[] = [];
    for (const p of periodos) {
      const bounds = getPeriodBounds(p.g === "MES" ? "month" : "quarter", p.ref);
      const r = await buildMetas(bounds, agoraApp);
      const bloco = r.blocos.find((b) => b.granularidade === p.g);
      if (!bloco) continue;
      for (const e of bloco.escopos) {
        if (!quer(e.slug)) continue;
        linhas.push({
          granularidade: p.g,
          periodoChave: p.chave,
          situacao: situacao(bounds),
          escopoSlug: e.slug,
          escopoNome: e.nome,
          abrangeTudo: e.abrangeTudo,
          ehTotal: false,
          meta: e.meta,
          realizado: e.realizado,
          percentual: e.percentual,
          falta: e.falta,
        });
      }
      // O total dos escopos por categoria só faz sentido com TODOS os escopos (com filtro de escopo seria enganoso).
      if (pedido.escopos.length === 0 && bloco.totalMeta !== null) {
        const falta = money(bloco.totalMeta).minus(money(bloco.totalRealizado));
        linhas.push({
          granularidade: p.g,
          periodoChave: p.chave,
          situacao: situacao(bounds),
          escopoSlug: "",
          escopoNome: NOME_TOTAL_ESCOPOS,
          abrangeTudo: false,
          ehTotal: true,
          meta: bloco.totalMeta,
          realizado: bloco.totalRealizado,
          percentual: bloco.percentualTotal,
          falta: toAmountString(falta.isNegative() ? ZERO : falta),
        });
      }
    }
    return linhas;
  });

  const eventosDb = await prisma.metaPeriodoEvent.findMany({
    where: { metaPeriodo: { periodoChave: { startsWith: `${pedido.ano}-` } } },
    orderBy: { criadoEm: "desc" },
    include: {
      metaPeriodo: { select: { granularidade: true, periodoChave: true, escopo: { select: { nome: true, slug: true } } } },
      alteradoPor: { select: { name: true } },
    },
  });
  const eventos: EventoMeta[] = eventosDb
    .filter((v) => pedido.granularidades.includes(v.metaPeriodo.granularidade) && quer(v.metaPeriodo.escopo.slug))
    .map((v) => ({
      quando: paraParede(v.criadoEm),
      granularidade: v.metaPeriodo.granularidade,
      periodoChave: v.metaPeriodo.periodoChave,
      escopoNome: v.metaPeriodo.escopo.nome,
      de: v.valorAnterior ? v.valorAnterior.toFixed(2) : null,
      para: v.valorNovo.toFixed(2),
      por: v.alteradoPor?.name ?? null,
    }));

  const escopos: EscopoMeta[] = escoposDb
    .filter((e) => quer(e.slug))
    .map((e) => ({ slug: e.slug, nome: e.nome, abrangeTudo: e.todasCategorias, ativo: e.ativo, categorias: e.categorias.map((c) => c.categoria) }));

  const frescor = await frescorDaReceita(agora);
  const pasta = montarAbasMetas({ linhas, eventos, escopos, pedido, geradoEm: agora, usuario, frescor: { texto: frescor.texto, alerta: frescor.alerta } });
  const entrega = await entregarAsync(
    pasta.abas,
    [
      {
        nomeAba: "Metas e realizado",
        titulos: ["Tipo", "Período", "Chave", "Situação do período", "Escopo", "Soma todas as categorias", "Meta", "Realizado", "% atingido", "Falta para a meta"],
        nLinhas: pasta.nLinhas,
        indiceValor: -1,
        total: null,
      },
    ],
    formato,
    "Metas e realizado",
  );

  return {
    buffer: entrega.buffer,
    nomeArquivo: nomeDoArquivoMetas(pedido, entrega.extensao),
    contentType: entrega.contentType,
    linhas: pasta.nLinhas,
    total: null,
    filtros: descreverPedidoMetas(pedido),
    dadosPessoais: false,
    filtrosJson: pedido,
  };
}
