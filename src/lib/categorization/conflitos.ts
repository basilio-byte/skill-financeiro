import "server-only";
import { prisma } from "@/lib/db";
import { money, roundMoney, ZERO } from "@/lib/money";
import { classificarConflito, type LinhaConflito, type ClassificacaoConflito } from "@/lib/categorization/classificar-conflito";

export type { LinhaConflito, ClassificacaoConflito };
export { classificarConflito };

/**
 * Faturas com "possível dupla contagem" — mesmo critério de
 * `totalFaturasComConflito` em persist.ts, aqui exposto por fatura (não só
 * contado) para uma tela de resolução.
 *
 * Causa raiz (achado real, 2026-07-24): uma linha revisada manualmente
 * (categoria/valor corrigidos à mão) nunca é apagada quando o motor deixa de
 * produzir aquele bucket numa rodada seguinte — preservada de propósito
 * (nunca perder uma correção humana às cegas). Se depois disso o motor passa
 * a gerar OUTRO bucket para a mesma fatura (ex.: uma regra nova mapeou o
 * serviço, ou a própria chave do bucket mudou de esquema — como aconteceu na
 * migração da ADR-0018, que passou a chavear "Sem Categoria" só pela
 * categoria, sem mais o sufixo `::servicoOuPlano`), as duas linhas juntas
 * passam a somar mais do que a fatura vale de verdade.
 */
const TOLERANCIA = money("0.02");

export interface FaturaConflito {
  crConexaId: number;
  razaoSocial: string | null;
  valorRecebidoTotal: string;
  somaAtual: string;
  diferenca: string;
  linhas: LinhaConflito[];
  classificacao: ClassificacaoConflito;
}

export async function listarConflitos(): Promise<FaturaConflito[]> {
  const linhas = await prisma.revenueCategorizedLine.findMany({
    orderBy: [{ crConexaId: "asc" }, { chaveLinha: "asc" }],
    include: { revisadoPor: { select: { name: true, email: true } } },
  });

  const porFatura = new Map<number, typeof linhas>();
  for (const l of linhas) {
    if (!porFatura.has(l.crConexaId)) porFatura.set(l.crConexaId, []);
    porFatura.get(l.crConexaId)!.push(l);
  }

  const conflitos: FaturaConflito[] = [];
  for (const [crConexaId, ls] of porFatura.entries()) {
    const valorTotal = money(ls[0]!.valorRecebidoTotal.toString());
    const soma = ls.reduce((acc, l) => acc.plus(money(l.valorRecebidoCat.toString())), ZERO);
    const diferenca = soma.minus(valorTotal);
    if (diferenca.abs().lessThanOrEqualTo(TOLERANCIA)) continue;

    const linhasFormatadas: LinhaConflito[] = ls.map((l) => ({
      id: l.id,
      categoria: l.categoria,
      chaveLinha: l.chaveLinha,
      servicoOuPlano: l.servicoOuPlano,
      valorRecebidoCat: roundMoney(money(l.valorRecebidoCat.toString())).toFixed(2),
      revisadoManualmente: l.revisadoManualmente,
      revisadoPorNome: l.revisadoPor?.name ?? l.revisadoPor?.email ?? null,
      revisadoEm: l.revisadoEm?.toISOString() ?? null,
      categoriaOriginal: l.categoriaOriginal,
      valorRecebidoCatOriginal: l.valorRecebidoCatOriginal
        ? roundMoney(money(l.valorRecebidoCatOriginal.toString())).toFixed(2)
        : null,
    }));

    conflitos.push({
      crConexaId,
      razaoSocial: ls[0]!.razaoSocial,
      valorRecebidoTotal: roundMoney(valorTotal).toFixed(2),
      somaAtual: roundMoney(soma).toFixed(2),
      diferenca: roundMoney(diferenca).toFixed(2),
      linhas: linhasFormatadas,
      classificacao: classificarConflito(linhasFormatadas),
    });
  }

  return conflitos.sort((a, b) => Number(b.diferenca) - Number(a.diferenca));
}
