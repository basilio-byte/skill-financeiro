import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toAmountString, ZERO } from "@/lib/money";
import type { CategorizedLine } from "@/lib/categorization/types";

export interface PersistResumo {
  totalLinhasNovas: number;
  totalLinhasAtualizadas: number;
  totalLinhasOrfasPreservadas: number;
  totalFaturasComConflito: number;
}

// Tolerância de arredondamento na conferência por fatura (rateio sempre fecha
// exato — regra #6 — então qualquer diferença real aqui não é arredondamento).
const TOLERANCIA_CONFERENCIA = money("0.02");

function toLineData(l: CategorizedLine) {
  return {
    crConexaId: l.crId,
    chaveLinha: l.chaveLinha,
    unidade: l.unidade || null,
    faturamento: l.faturamento || null,
    clienteConexaId: l.clienteId,
    cpfCnpj: l.cpfCnpj || null,
    razaoSocial: l.razaoSocial || null,
    planoContratado: l.planoContratado || null,
    categoria: l.categoria,
    servicoOuPlano: l.servicoOuPlano,
    proporcionado: l.proporcionado,
    tipo: l.tipo || null,
    status: l.status || null,
    parcela: l.parcela || null,
    valorRecebidoCat: toAmountString(l.valorRecebidoCategoria),
    valorRecebidoTotal: toAmountString(l.valorRecebidoTotal),
    valorBruto: toAmountString(l.valorBruto),
    valorDesconto: toAmountString(l.valorDesconto),
    vencimento: l.vencimento,
    quitacao: l.quitacao,
    competencia: l.competencia,
    emissao: l.emissao,
    dataCredito: l.dataCredito,
    conta: l.conta || null,
    observacoes: l.observacoes || null,
    tags: l.tags || null,
    raw: l.raw as unknown as Prisma.InputJsonValue,
  };
}

const chaveExistente = (crConexaId: number, chaveLinha: string) => `${crConexaId}::${chaveLinha}`;

/**
 * Persiste as linhas de uma rodada via UPSERT por (crConexaId, chaveLinha) —
 * ver ADR-0013. Nunca cria linhas novas por rodada: cada bucket de fatura tem
 * UMA linha atual, atualizada in-place — é isso que permite sincronizar a
 * cada 15 min sem crescer a tabela sem limite.
 *
 * Proteção da revisão manual (financial-rigor.md #9/#10): quando a linha
 * existente já foi revisada manualmente, `categoria`/`valorRecebidoCat` são
 * OMITIDOS do update (o Prisma simplesmente não toca nesses dois campos) —
 * todo o resto (datas, status, raw, etc — dados factuais do Conexa, não
 * decisões da skill) continua atualizando normalmente mesmo em linhas revisadas.
 *
 * Órfãs: uma linha existente cujo (crConexaId, chaveLinha) não aparece mais
 * no resultado desta rodada (ex.: a composição de itens da fatura mudou, ou
 * uma revisão manual "adivinhou" uma categoria que passou a ser mapeada de
 * verdade) é apagada — EXCETO se estiver revisada manualmente, caso em que é
 * preservada e contada em `totalLinhasOrfasPreservadas` (nunca some
 * silenciosamente — regra #8). Quando isso acontece, a fatura é conferida:
 * se a soma de TODAS as suas linhas atuais não bater com o valor total dela,
 * é sinal de dupla contagem (a linha preservada + um bucket novo cobrindo a
 * mesma receita) — contado em `totalFaturasComConflito` e logado alto, nunca
 * corrigido sozinho (só um humano decide qual versão é a certa).
 *
 * TUDO isso (leitura do estado atual, delete de órfãs, upserts) roda numa
 * ÚNICA transação Serializable — achado real por verificação adversarial: ler
 * `revisadoManualmente` numa query separada e só decidir/gravar depois (como
 * a v1 desta função fazia) é um TOCTOU: uma revisão manual feita por um admin
 * (`updateCategorizedLineAction`) bem no meio dessa janela podia ser
 * silenciosamente sobrescrita — ou, no caso de uma linha órfã, até APAGADA —
 * por uma sincronização automática que a viu como "ainda não revisada" um
 * instante antes. Serializable faz o Postgres abortar (P2034) uma das duas
 * transações que colidirem (mesmo padrão de `inSerializableGuard` em
 * auth/user-actions.ts e do guard de `startCategorizationRun` em run.ts) — e
 * por isso `updateCategorizedLineAction` também precisa ser Serializable
 * (ver actions.ts), senão o Postgres não tem como detectar o conflito entre
 * as duas.
 */
export async function persistLinhasCategorizadas(
  syncRunId: string,
  linhas: CategorizedLine[],
): Promise<PersistResumo> {
  return prisma.$transaction(
    async (tx) => {
      const crConexaIds = [...new Set(linhas.map((l) => l.crId))];

      const existentes = crConexaIds.length
        ? await tx.revenueCategorizedLine.findMany({
            where: { crConexaId: { in: crConexaIds } },
            select: { id: true, crConexaId: true, chaveLinha: true, revisadoManualmente: true },
          })
        : [];

      const revisadaAntes = new Map<string, boolean>();
      for (const e of existentes) {
        revisadaAntes.set(chaveExistente(e.crConexaId, e.chaveLinha), e.revisadoManualmente);
      }

      const chavesNovasPorFatura = new Map<number, Set<string>>();
      for (const l of linhas) {
        if (!chavesNovasPorFatura.has(l.crId)) chavesNovasPorFatura.set(l.crId, new Set());
        chavesNovasPorFatura.get(l.crId)!.add(l.chaveLinha);
      }

      let totalLinhasOrfasPreservadas = 0;
      const idsOrfasParaApagar: string[] = [];
      const faturasComOrfaPreservada = new Set<number>();
      for (const e of existentes) {
        const aindaExisteNestaRodada = chavesNovasPorFatura.get(e.crConexaId)?.has(e.chaveLinha) ?? false;
        if (aindaExisteNestaRodada) continue;
        if (e.revisadoManualmente) {
          totalLinhasOrfasPreservadas += 1;
          faturasComOrfaPreservada.add(e.crConexaId);
        } else {
          idsOrfasParaApagar.push(e.id);
        }
      }
      if (idsOrfasParaApagar.length > 0) {
        await tx.revenueCategorizedLine.deleteMany({ where: { id: { in: idsOrfasParaApagar } } });
      }

      let totalLinhasNovas = 0;
      let totalLinhasAtualizadas = 0;
      for (const l of linhas) {
        const chave = chaveExistente(l.crId, l.chaveLinha);
        const estadoAnterior = revisadaAntes.get(chave);
        if (estadoAnterior === undefined) totalLinhasNovas += 1;
        else totalLinhasAtualizadas += 1;

        const dados = toLineData(l);
        // Prisma ignora chaves com valor `undefined` num update (equivalente a
        // omiti-las) — forma limpa de "não tocar" categoria/valor sem duplicar
        // o objeto inteiro.
        const protegeRevisaoManual = estadoAnterior === true;

        await tx.revenueCategorizedLine.upsert({
          where: { crConexaId_chaveLinha: { crConexaId: l.crId, chaveLinha: l.chaveLinha } },
          create: { ...dados, ultimaRodadaId: syncRunId },
          update: {
            ...dados,
            categoria: protegeRevisaoManual ? undefined : dados.categoria,
            valorRecebidoCat: protegeRevisaoManual ? undefined : dados.valorRecebidoCat,
            ultimaRodadaId: syncRunId,
          },
        });
      }

      // Conferência por fatura (achado por verificação adversarial): uma linha
      // órfã preservada porque está revisada manualmente (ex.: um serviço
      // "Sem Categoria" foi corrigido à mão para uma categoria real) pode, mais
      // tarde, ganhar uma regra de verdade em RevenueCategoryRule — a próxima
      // rodada então cria um bucket NOVO (chaveLinha diferente) com o valor
      // certo, enquanto a linha antiga continua preservada (nunca apagada,
      // regra #9). As duas juntas contam a mesma receita duas vezes. Não dá
      // pra resolver isso automaticamente sem decidir qual das duas versões é
      // a certa — só um humano pode (mesma regra: revisão manual é a única
      // exceção, e nunca é revertida sozinha). Em vez disso, detecta e nunca
      // deixa passar em silêncio (regra #8): confere, por fatura, se a soma
      // de TODAS as linhas atuais bate com o valor total da fatura.
      let totalFaturasComConflito = 0;
      if (faturasComOrfaPreservada.size > 0) {
        const totalPorFatura = new Map<number, string>();
        for (const l of linhas) {
          if (faturasComOrfaPreservada.has(l.crId) && !totalPorFatura.has(l.crId)) {
            totalPorFatura.set(l.crId, toAmountString(l.valorRecebidoTotal));
          }
        }
        for (const crConexaId of faturasComOrfaPreservada) {
          const valorTotal = totalPorFatura.get(crConexaId);
          if (!valorTotal) continue; // fatura não fez parte desta rodada (raro; nada a conferir agora)
          const linhasAtuais = await tx.revenueCategorizedLine.findMany({
            where: { crConexaId },
            select: { valorRecebidoCat: true },
          });
          const somaAtual = linhasAtuais.reduce((acc, l) => acc.plus(money(l.valorRecebidoCat.toString())), ZERO);
          if (somaAtual.minus(money(valorTotal)).abs().greaterThan(TOLERANCIA_CONFERENCIA)) {
            totalFaturasComConflito += 1;
            console.error(
              `[persist] CONFLITO: fatura crConexaId=${crConexaId} tem soma de linhas (${somaAtual.toString()}) ` +
                `diferente do valor total da fatura (${valorTotal}) — provável dupla contagem entre uma linha ` +
                `revisada manualmente preservada e um bucket novo criado após a categoria ser mapeada de verdade. ` +
                `Requer revisão humana em /revisar ou /runs.`,
            );
          }
        }
      }

      return { totalLinhasNovas, totalLinhasAtualizadas, totalLinhasOrfasPreservadas, totalFaturasComConflito };
    },
    { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 },
  );
}
