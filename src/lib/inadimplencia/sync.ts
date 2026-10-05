import "server-only";
import { prisma } from "@/lib/db";
import { getEnv, hasConexaApiToken } from "@/lib/env";
import { keyToUtcDate, todayKey } from "@/lib/dates";
import { money, sum, toAmountString } from "@/lib/money";
import { buscarPorIds, listarTudo } from "@/lib/conexa-api/client";
import {
  contatoDoCliente,
  mapearCobranca,
  STATUS_DE_DIVIDA,
  type ClienteApi,
  type CobrancaApi,
} from "@/lib/inadimplencia/dominio";

/**
 * Sincronização da inadimplência (ADR-0031).
 *
 * ⚠ ISOLAMENTO é a propriedade que importa: esta função só LÊ do Conexa e só
 * ESCREVE em `cobrancas_em_aberto` e `inadimplencia_sync_runs`. Não toca
 * RevenueCategorizedLine, RevenueSyncRun, metas nem ClickUp — a receita já
 * apurada não tem como ser alterada por nada que aconteça aqui.
 *
 * ⚠ ATOMICIDADE: a lista inteira é montada em memória ANTES de o banco ser
 * tocado, e a troca (apaga + recria) é uma única transação. Falha em qualquer
 * página da API lança antes disso — o espelho antigo continua intacto e a tela
 * segue mostrando o último retrato bom, com a data dele.
 */

export class InadimplenciaSyncError extends Error {}

const RODADA_TRAVADA_MS = 30 * 60_000;

interface CompanyApi {
  companyId?: number;
  name?: string | null;
  tradeName?: string | null;
}

export interface ResumoSyncInadimplencia {
  total: number;
  valorTotal: string;
  descartadas: number;
}

/** Último dia-calendário ANTES de hoje (fuso do app), como yyyy-MM-dd. */
function ontemKey(hoje: Date): string {
  return new Date(hoje.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export async function sincronizarInadimplencia(): Promise<ResumoSyncInadimplencia> {
  if (!hasConexaApiToken()) throw new InadimplenciaSyncError("CONEXA_API_TOKEN não configurado.");

  // Guard de concorrência — mesma ideia do run.ts: RUNNING recente = alguém já está
  // rodando; RUNNING velho = processo morreu no meio, destrava.
  const jaRodando = await prisma.inadimplenciaSyncRun.findFirst({ where: { status: "RUNNING" } });
  if (jaRodando) {
    if (Date.now() - jaRodando.iniciadoEm.getTime() < RODADA_TRAVADA_MS) {
      throw new InadimplenciaSyncError("Já existe uma sincronização de inadimplência em andamento.");
    }
    await prisma.inadimplenciaSyncRun.update({
      where: { id: jaRodando.id },
      data: { status: "FAILED", concluidoEm: new Date(), erro: "Rodada travada em RUNNING — liberada automaticamente." },
    });
  }

  const run = await prisma.inadimplenciaSyncRun.create({ data: { status: "RUNNING" } });

  try {
    const hoje = keyToUtcDate(todayKey());
    const ate = ontemKey(hoje);

    // 1) Cobranças — filtro de status e vencimento NO SERVIDOR. É o ganho sobre o
    //    export web, que baixava o histórico inteiro, pagas incluídas.
    const brutas: CobrancaApi[] = [];
    for (const status of STATUS_DE_DIVIDA) {
      brutas.push(...(await listarTudo<CobrancaApi>("charges", { status, dueDateTo: ate })));
    }

    // 2) Mapeia com o MESMO critério de domínio (defesa em profundidade: não confia
    //    que o filtro da API foi respeitado — a regra é nossa, e testada).
    const vistos = new Set<number>();
    const linhas: NonNullable<ReturnType<typeof mapearCobranca>>[] = [];
    let descartadas = 0;
    for (const c of brutas) {
      const l = mapearCobranca(c, hoje);
      if (!l) {
        descartadas += 1;
        continue;
      }
      if (vistos.has(l.conexaId)) continue; // a mesma cobrança não pode contar duas vezes
      vistos.add(l.conexaId);
      linhas.push(l);
    }
    if (descartadas > 0) {
      console.warn(`[inadimplencia] ${descartadas} cobrança(s) descartada(s) (fora do critério ou sem valor legível).`);
    }

    // 3) Clientes e unidades. Falha aqui NÃO é fatal: nome vira "Cliente #id". O
    //    que não pode acontecer é perder a lista de dívida por causa de um nome.
    const clientes = new Map<number, ClienteApi>();
    const unidades = new Map<number, string>();
    try {
      const ids = [...new Set(linhas.map((l) => l.customerConexaId).filter((x): x is number => x !== null))];
      for (const c of await buscarPorIds<ClienteApi>("customers", ids)) {
        if (c.customerId) clientes.set(c.customerId, c);
      }
      for (const u of await listarTudo<CompanyApi>("companies")) {
        if (u.companyId) unidades.set(u.companyId, u.name ?? u.tradeName ?? `Unidade ${u.companyId}`);
      }
    } catch (err) {
      console.warn("[inadimplencia] nomes/unidades indisponíveis nesta rodada:", err instanceof Error ? err.message : err);
    }

    const registros = linhas.map((l) => {
      const cli = l.customerConexaId !== null ? clientes.get(l.customerConexaId) : undefined;
      const contato = cli ? contatoDoCliente(cli) : { telefone: null, email: null };
      return {
        conexaId: l.conexaId,
        companyConexaId: l.companyConexaId,
        unidade: l.companyConexaId !== null ? (unidades.get(l.companyConexaId) ?? null) : null,
        customerConexaId: l.customerConexaId,
        clienteNome: cli?.name ?? null,
        clienteFantasia: cli?.tradeName ?? null,
        telefone: contato.telefone,
        email: contato.email,
        status: l.status,
        tipo: l.tipo,
        valor: l.valor,
        valorOriginal: l.valorOriginal,
        vencimento: l.vencimento,
        competencia: l.competencia,
        atualizadoNoConexa: l.atualizadoNoConexa,
      };
    });

    // 4) Trava contra apagar tudo por engano. Lista vazia sobre um espelho cheio é o
    //    sintoma de token sem permissão, filtro ignorado ou API degradada — não de
    //    "todo mundo pagou". Aborta e deixa o espelho antigo intacto.
    const existentes = await prisma.cobrancaEmAberto.count();
    if (registros.length === 0 && existentes > 20) {
      throw new InadimplenciaSyncError(
        `A API devolveu 0 cobranças em atraso, mas o espelho tem ${existentes}. Nada foi apagado — ` +
          "verifique o token e os filtros antes de aceitar uma lista vazia.",
      );
    }
    if (existentes >= 50 && registros.length < existentes * 0.5) {
      console.warn(
        `[inadimplencia] a lista caiu de ${existentes} para ${registros.length} (>50%) — conferir se foi uma quitação em massa.`,
      );
    }

    // 5) Troca atômica: quem lê vê o retrato antigo OU o novo, nunca meio a meio.
    await prisma.$transaction(
      async (tx) => {
        await tx.cobrancaEmAberto.deleteMany({});
        for (let i = 0; i < registros.length; i += 1000) {
          await tx.cobrancaEmAberto.createMany({ data: registros.slice(i, i + 1000) });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    const valorTotal = toAmountString(sum(registros.map((r) => money(r.valor))));
    await prisma.inadimplenciaSyncRun.update({
      where: { id: run.id },
      data: { status: "DONE", concluidoEm: new Date(), total: registros.length, valorTotal },
    });
    return { total: registros.length, valorTotal, descartadas };
  } catch (err) {
    await prisma.inadimplenciaSyncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", concluidoEm: new Date(), erro: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Chamada pelo agendador a cada tick de 15 min, mas só trabalha quando o
 * intervalo (lido do BANCO, não de memória — deploy reinicia o processo) venceu.
 * Nunca lança: o agendador de receita não pode ser afetado por nada daqui.
 */
export async function sincronizarInadimplenciaSeVencida(): Promise<void> {
  try {
    const env = getEnv();
    if (!env.INADIMPLENTES_SYNC_ENABLED || !hasConexaApiToken()) return;

    const ultima = await prisma.inadimplenciaSyncRun.findFirst({
      orderBy: { iniciadoEm: "desc" },
      select: { iniciadoEm: true, status: true },
    });
    // Depois de uma FALHA não faz sentido esperar o intervalo cheio (2h): a causa costuma
    // ser transitória ou já corrigida por um deploy — foi o caso em 2026-10-05, quando a
    // URL errada da API ficou 2h "castigada" depois do conserto. Tenta de novo em 15 min.
    const intervaloMin =
      ultima?.status === "FAILED" ? Math.min(15, env.INADIMPLENTES_SYNC_INTERVALO_MINUTOS) : env.INADIMPLENTES_SYNC_INTERVALO_MINUTOS;
    if (ultima && Date.now() - ultima.iniciadoEm.getTime() < intervaloMin * 60_000) return;

    const r = await sincronizarInadimplencia();
    console.log(`[inadimplencia] ${r.total} cobrança(s) em atraso, R$ ${r.valorTotal}.`);
  } catch (err) {
    console.error("[inadimplencia] falha (a sincronização de receita não foi afetada):", err instanceof Error ? err.message : err);
  }
}
