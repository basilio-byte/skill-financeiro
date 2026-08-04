import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { money, toAmountString, ZERO } from "@/lib/money";
import type { CategorizedLine } from "@/lib/categorization/types";
import { mesDoCreditoOuSentinela, mesesNoIntervalo } from "@/lib/categorization/mes-credito";

export interface PersistResumo {
  totalLinhasNovas: number;
  totalLinhasAtualizadas: number;
  totalLinhasOrfasPreservadas: number;
  totalFaturasComConflito: number;
}

// Achado de auditoria 2026-07-23: o guard de "rodada travada" em run.ts
// (RODADA_TRAVADA_MS) assume que RUNNING há mais de 30 min só pode significar
// processo morto — mas os fetches ao Conexa não têm timeout (antes desta
// mesma auditoria), então uma rodada só "lenta" (rede degradada, export
// grande) podia continuar viva depois de outra já ter marcado FAILED e
// liberado uma rodada nova para o mesmo período. As duas persistiriam
// concorrentemente sem nenhum sinal de qual é a válida. Rechecar o status
// AQUI DENTRO da transação Serializable (não numa query separada antes —
// seria o mesmo TOCTOU que o resto deste arquivo já evita) fecha essa janela:
// se outra rodada já marcou esta como FAILED, aborta sem persistir nada.
export class RodadaSuperadaError extends Error {}

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
    // Parte da IDENTIDADE da linha (ADR-0029), derivada aqui e não recebida
    // pronta: uma única fonte para o valor que vai para a coluna e para o
    // `where` do upsert — se os dois pudessem divergir, o upsert criaria linha
    // nova achando que não existe.
    mesCredito: mesDoCreditoOuSentinela(l.dataCredito),
    conta: l.conta || null,
    observacoes: l.observacoes || null,
    tags: l.tags || null,
    raw: l.raw as unknown as Prisma.InputJsonValue,
    // Detalhe por item (ADR-0028). `?? Prisma.DbNull` e não `undefined`: numa
    // linha SEM_LV (fatura sem LV casado) não existe item nenhum, e o upsert
    // precisa GRAVAR null — deixar `undefined` faria o update preservar um
    // valor antigo de uma rodada anterior em que a mesma linha tinha itens.
    itensDetalhe: (l.itens as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
    ajusteArredondamento: l.ajusteArredondamento ?? null,
  };
}

/**
 * Identidade da linha em memória — precisa ser EXATAMENTE a mesma tripla do
 * `@@unique([crConexaId, chaveLinha, mesCredito])`. Se as duas divergirem, o
 * upsert acha que está criando e o banco acusa violação de índice, ou pior: a
 * detecção de órfã passa a comparar maçã com laranja e apaga linha boa.
 */
const chaveExistente = (crConexaId: number, chaveLinha: string, mesCredito: string) =>
  `${crConexaId}::${chaveLinha}::${mesCredito}`;

/**
 * Persiste as linhas de uma rodada via UPSERT por
 * (crConexaId, chaveLinha, mesCredito) — ADR-0013 + ADR-0029. Cada bucket de
 * fatura tem UMA linha atual POR MÊS DE CRÉDITO, atualizada in-place: é isso que
 * permite sincronizar a cada 15 min sem crescer a tabela sem limite.
 *
 * O mês entra na identidade porque cobrança recorrente tem uma LISTA de datas de
 * crédito, uma por parcela, e entrega o mesmo valor em cada mês. Sem ele, a
 * rodada de agosto reescrevia a `dataCredito` da linha de julho e a receita
 * migrava de mês (ADR-0029: 10 faturas, R$ 1.097,07, provado em produção).
 *
 * Proteção da revisão manual (financial-rigor.md #9/#10): quando a linha
 * existente já foi revisada manualmente, `categoria`/`valorRecebidoCat` são
 * OMITIDOS do update (o Prisma simplesmente não toca nesses dois campos) —
 * todo o resto (datas, status, raw, etc — dados factuais do Conexa, não
 * decisões da skill) continua atualizando normalmente mesmo em linhas revisadas.
 *
 * Órfãs: uma linha existente cuja tripla não aparece mais no resultado desta
 * rodada (ex.: a composição de itens da fatura mudou, ou uma revisão manual
 * "adivinhou" uma categoria que passou a ser mapeada de verdade) é apagada —
 * EXCETO se estiver revisada manualmente, caso em que é preservada e contada em
 * `totalLinhasOrfasPreservadas` (nunca some silenciosamente — regra #8).
 *
 * **Só é candidata a órfã a linha cujo `mesCredito` está entre os meses DESTA
 * rodada** (ADR-0029). Sem esse escopo, a rodada de agosto veria as linhas de
 * julho da mesma fatura recorrente — que legitimamente não estão no resultado
 * dela — e as apagaria, trocando "a receita migra de mês" por "a receita some de
 * vez". É o ponto de maior risco desta mudança.
 *
 * Quando há órfã preservada, a fatura é conferida POR MÊS: se a soma das linhas
 * daquele mês não bater com o valor da fatura, é sinal de dupla contagem (a
 * linha preservada + um bucket novo cobrindo a mesma receita) — contado em
 * `totalFaturasComConflito` e logado alto, nunca corrigido sozinho (só um humano
 * decide qual versão é a certa). A conferência é por mês e não por fatura porque
 * o valor de referência é o de UMA parcela: somar os meses todos de uma
 * recorrente acusaria conflito em toda fatura parcelada, todo mês.
 *
 * Faturas que SOMEM por completo (achado real, 2026-07-24 — R$6.029,12 em 28
 * faturas): o `existentes` abaixo busca por `dataCredito` dentro do período
 * da PRÓPRIA rodada, não só por `crConexaId` das faturas que `linhas` ainda
 * contém. Sem isso, uma fatura que foi aceita numa rodada antiga e depois
 * desaparece por completo do resultado (status mudou pra algo não aceito, ou
 * a Data Crédito foi corrigida/mudou de mês no Conexa) nunca entrava em
 * `existentes` — sua linha ficava no banco pra sempre, nunca reavaliada,
 * contando dinheiro que o Conexa não reconhece mais pra este período. Isso é
 * DIFERENTE de uma órfã comum (a fatura continua aparecendo, só muda de
 * bucket) — aqui a fatura some inteira. O resto da lógica de órfã (preservar
 * se revisada manualmente, apagar senão) já cobre esse caso corretamente
 * assim que a linha é encontrada — só faltava buscá-la.
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
  periodoInicio: Date,
  periodoFim: Date,
): Promise<PersistResumo> {
  return prisma.$transaction(
    async (tx) => {
      const rodada = await tx.revenueSyncRun.findUnique({ where: { id: syncRunId }, select: { status: true } });
      if (rodada?.status !== "RUNNING") {
        throw new RodadaSuperadaError(
          `Rodada ${syncRunId} não está mais RUNNING (status atual: ${rodada?.status ?? "inexistente"}) — ` +
            "provavelmente foi marcada FAILED por um guard de rodada travada enquanto esta ainda processava. Abortando sem persistir.",
        );
      }

      const crConexaIds = [...new Set(linhas.map((l) => l.crId))];

      // Meses que ESTA rodada é responsável por manter em dia. Tudo o que estiver
      // fora deles é assunto de outra rodada e não pode ser tocado aqui.
      const mesesDaRodada = mesesNoIntervalo(periodoInicio, periodoFim);

      // O `crConexaId IN (...)` é ESCOPADO POR MÊS — e isso não é otimização, é o
      // ponto mais perigoso da ADR-0029. Sem o escopo, a rodada de agosto traria
      // para `existentes` as linhas de JULHO da mesma fatura recorrente; elas não
      // aparecem no resultado de agosto (mês diferente = chave diferente), seriam
      // classificadas como órfãs e APAGADAS. Trocaríamos "a receita migra de mês"
      // por "a receita some de vez" — estrago maior que o bug original.
      //
      // O segundo ramo (dataCredito dentro do período) já é escopado por
      // construção e continua fazendo o trabalho da ADR-0020: pegar faturas que
      // sumiram por completo do resultado desta rodada.
      const existentes = await tx.revenueCategorizedLine.findMany({
        where: {
          OR: [
            ...(crConexaIds.length && mesesDaRodada.length
              ? [{ crConexaId: { in: crConexaIds }, mesCredito: { in: mesesDaRodada } }]
              : []),
            { dataCredito: { gte: periodoInicio, lte: periodoFim } },
          ],
        },
        select: { id: true, crConexaId: true, chaveLinha: true, mesCredito: true, revisadoManualmente: true },
      });

      const revisadaAntes = new Map<string, boolean>();
      for (const e of existentes) {
        revisadaAntes.set(chaveExistente(e.crConexaId, e.chaveLinha, e.mesCredito), e.revisadoManualmente);
      }

      // Conjunto das identidades COMPLETAS produzidas por esta rodada.
      const chavesNovas = new Set<string>();
      for (const l of linhas) {
        chavesNovas.add(chaveExistente(l.crId, l.chaveLinha, mesDoCreditoOuSentinela(l.dataCredito)));
      }

      let totalLinhasOrfasPreservadas = 0;
      const idsOrfasParaApagar: string[] = [];
      const faturasComOrfaPreservada = new Set<string>();
      for (const e of existentes) {
        // Cinto de segurança além do escopo da query: mesmo que algo entre em
        // `existentes` fora dos meses desta rodada (o segundo ramo do OR pode
        // trazer uma linha cuja dataCredito foi corrigida para outro mês), ela
        // NUNCA é candidata a órfã aqui.
        if (!mesesDaRodada.includes(e.mesCredito)) continue;
        const aindaExisteNestaRodada = chavesNovas.has(chaveExistente(e.crConexaId, e.chaveLinha, e.mesCredito));
        if (aindaExisteNestaRodada) continue;
        if (e.revisadoManualmente) {
          totalLinhasOrfasPreservadas += 1;
          // Guarda fatura + MÊS: a conferência abaixo compara a soma das linhas
          // com o valor da fatura, e esse valor é de UMA parcela. Somar as linhas
          // de todos os meses de uma recorrente daria "conflito" em toda fatura
          // parcelada, todo mês — alarme falso em massa.
          faturasComOrfaPreservada.add(`${e.crConexaId}::${e.mesCredito}`);
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
        const mesCredito = mesDoCreditoOuSentinela(l.dataCredito);
        const chave = chaveExistente(l.crId, l.chaveLinha, mesCredito);
        const estadoAnterior = revisadaAntes.get(chave);
        if (estadoAnterior === undefined) totalLinhasNovas += 1;
        else totalLinhasAtualizadas += 1;

        const dados = toLineData(l);
        // Prisma ignora chaves com valor `undefined` num update (equivalente a
        // omiti-las) — forma limpa de "não tocar" categoria/valor sem duplicar
        // o objeto inteiro.
        const protegeRevisaoManual = estadoAnterior === true;

        await tx.revenueCategorizedLine.upsert({
          where: {
            crConexaId_chaveLinha_mesCredito: { crConexaId: l.crId, chaveLinha: l.chaveLinha, mesCredito },
          },
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
      //
      // ADR-0029: a conferência é por (fatura, MÊS), não por fatura. O valor de
      // referência (`valorRecebidoTotal`) é o de UMA parcela — o Conexa exporta
      // uma parcela por cobrança. Somar as linhas de todos os meses de uma
      // recorrente daria diferença em toda fatura parcelada, todo mês, e o alarme
      // que existe para achar dupla contagem de verdade viraria ruído constante.
      let totalFaturasComConflito = 0;
      if (faturasComOrfaPreservada.size > 0) {
        const totalPorFaturaMes = new Map<string, string>();
        for (const l of linhas) {
          const chaveFaturaMes = `${l.crId}::${mesDoCreditoOuSentinela(l.dataCredito)}`;
          if (faturasComOrfaPreservada.has(chaveFaturaMes) && !totalPorFaturaMes.has(chaveFaturaMes)) {
            totalPorFaturaMes.set(chaveFaturaMes, toAmountString(l.valorRecebidoTotal));
          }
        }
        for (const chaveFaturaMes of faturasComOrfaPreservada) {
          const valorTotal = totalPorFaturaMes.get(chaveFaturaMes);
          if (!valorTotal) continue; // fatura/mês não fez parte desta rodada (raro; nada a conferir agora)
          const [crConexaIdTexto, mesCredito] = chaveFaturaMes.split("::");
          const crConexaId = Number(crConexaIdTexto);
          const linhasAtuais = await tx.revenueCategorizedLine.findMany({
            where: { crConexaId, mesCredito },
            select: { valorRecebidoCat: true },
          });
          const somaAtual = linhasAtuais.reduce((acc, l) => acc.plus(money(l.valorRecebidoCat.toString())), ZERO);
          if (somaAtual.minus(money(valorTotal)).abs().greaterThan(TOLERANCIA_CONFERENCIA)) {
            totalFaturasComConflito += 1;
            console.error(
              `[persist] CONFLITO: fatura crConexaId=${crConexaId} em ${mesCredito} tem soma de linhas (${somaAtual.toString()}) ` +
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
