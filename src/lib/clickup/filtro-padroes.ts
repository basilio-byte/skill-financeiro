import { normalizarTexto } from "@/lib/text-normalize";

/**
 * Um vínculo ClickUp soma TODAS as linhas cuja categoria bate E cujo
 * `servicoOuPlano` contém QUALQUER UM dos padrões (OR) — nunca um cliente
 * específico (ver comentário do model ClickUpVinculo em schema.prisma).
 * Módulo separado (puro, sem Prisma runtime/DB) para ser reaproveitado tanto
 * pelo push real (push.ts) quanto pela prévia da tela admin (actions.ts),
 * sem duplicar a lógica de comparação.
 *
 * O casamento (`bateAlgumPadrao`) acontece em JS, não numa query `contains`
 * do Postgres — achado real (usuário, 2026-07-27): a mesma categoria tem
 * variantes de ACENTO na Conexa (ex. "Comércio" e "Comercio" convivem no
 * `servicoOuPlano` real), e o Postgres só ignora maiúscula/minúscula por
 * padrão (`mode: "insensitive"`), nunca acento — um padrão digitado com
 * acento não bateria na variante sem acento (e vice-versa) sem essa
 * normalização. Por isso quem chama busca as linhas só por `categoria` (e
 * `dataCredito` quando for o caso) e filtra por padrão aqui, em memória.
 */

export class PadroesVazioError extends Error {}

/** Texto solto (um padrão por linha ou separado por vírgula) -> lista limpa, sem duplicatas nem vazios. */
export function normalizarPadroes(bruto: string): string[] {
  const vistos = new Set<string>();
  const limpos: string[] = [];
  for (const parte of bruto.split(/\r?\n|,/)) {
    const p = parte.trim();
    if (!p || vistos.has(p)) continue;
    vistos.add(p);
    limpos.push(p);
  }
  return limpos;
}

/**
 * `servicoOuPlano` contém QUALQUER UM dos padrões, ignorando acento e caixa
 * dos dois lados — "Comércio" (padrão) bate em "...De Comercio Mensal..."
 * (linha real) e vice-versa.
 */
export function bateAlgumPadrao(servicoOuPlano: string, padroes: string[]): boolean {
  if (padroes.length === 0) {
    throw new PadroesVazioError("Vínculo sem nenhum padrão — não há o que casar.");
  }
  const alvo = normalizarTexto(servicoOuPlano);
  return padroes.some((padrao) => alvo.includes(normalizarTexto(padrao)));
}

export interface VinculoExistente {
  id: string;
  clickUpTaskId: string;
  padroes: string[];
}

export interface Sobreposicao {
  servicoOuPlano: string;
  vinculoId: string;
  clickUpTaskId: string;
}

/**
 * Acha, entre uma lista de linhas candidatas (as que um padrão NOVO casaria),
 * quais delas TAMBÉM batem em algum vínculo já ativo da mesma categoria.
 *
 * Por quê: achado real (Salas Privativas, 2026-07-27) — uma fatura pode
 * combinar VÁRIAS salas na mesma linha de `servicoOuPlano` (ex. um cliente
 * que aluga 3 salas de uma vez, texto vira "Contrato: Sala 08...; Contrato:
 * Sala 09...; Contrato: Sala 10..." com um valor ÚNICO pras 3 juntas). Se dois
 * vínculos diferentes (um por sala) casarem essa MESMA linha, os dois somam o
 * valor INTEIRO da linha — o total combinado é contado uma vez por vínculo
 * que bater, multiplicando dinheiro que não existe. Nunca detectável só pela
 * prévia de UM vínculo isolado; por isso compara contra os vínculos VIZINHOS
 * já cadastrados.
 */
export function acharSobreposicoes(
  linhas: Array<{ servicoOuPlano: string }>,
  outrosVinculosDaMesmaCategoria: VinculoExistente[],
): Sobreposicao[] {
  const achadas: Sobreposicao[] = [];
  const vistos = new Set<string>();
  for (const linha of linhas) {
    const chave = linha.servicoOuPlano;
    if (vistos.has(chave)) continue;
    for (const outro of outrosVinculosDaMesmaCategoria) {
      if (bateAlgumPadrao(linha.servicoOuPlano, outro.padroes)) {
        achadas.push({ servicoOuPlano: chave, vinculoId: outro.id, clickUpTaskId: outro.clickUpTaskId });
        vistos.add(chave);
        break;
      }
    }
  }
  return achadas;
}

export interface VinculoAtivo extends VinculoExistente {
  criadoEm: Date;
}

/**
 * Decide quais linhas somam pra ESTE vínculo quando outros vínculos ATIVOS da
 * mesma categoria também batem na mesma linha (fatura combinando várias
 * salas/produtos, ver `acharSobreposicoes` acima).
 *
 * Por quê isto precisa existir separado da checagem em `criarVinculoAction`:
 * aquela checagem só impede a CRIAÇÃO de um vínculo cujo histórico, NAQUELE
 * MOMENTO, já pertence a outro vínculo — não protege contra uma fatura FUTURA
 * que combine salas cujos vínculos já existiam sem conflito na criação.
 * Achado real (Serviços de Espaço - Seaway Center, 2026-07-28): 29% das
 * faturas históricas já combinam 2+ salas na mesma linha — reserva avulsa de
 * sala de reunião, não uma exceção rara como em Salas Privativas. Sem este
 * filtro no push, `pushUmVinculo` somaria a linha inteira em CADA vínculo que
 * bater, TODO mês em que a combinação se repetisse, sem nenhum aviso.
 *
 * Desempate determinístico (mesmo vencedor sempre, os dois lados calculam
 * igual): o vínculo criado PRIMEIRO (`criadoEm` mais antigo; `id` como
 * desempate de empate exato) fica com a linha; todo vínculo mais novo que
 * também bater a exclui da própria soma.
 */
export function linhasExclusivasDoVinculo<T extends { servicoOuPlano: string }>(
  linhas: T[],
  vinculoAtual: VinculoAtivo,
  outrosAtivosDaMesmaCategoria: VinculoAtivo[],
): T[] {
  return particionarPorReivindicacao(linhas, vinculoAtual, outrosAtivosDaMesmaCategoria).incluidas;
}

export interface LinhaReivindicada<T> {
  linha: T;
  /** O vínculo mais antigo que ficou com esta linha (é dele que ela soma). */
  reivindicadaPor: VinculoAtivo;
}

export interface ParticaoPorReivindicacao<T> {
  incluidas: T[];
  excluidas: Array<LinhaReivindicada<T>>;
}

/**
 * Mesma decisão de `linhasExclusivasDoVinculo`, mas devolvendo TAMBÉM as linhas
 * que ficaram de fora e QUEM ficou com cada uma.
 *
 * Existe porque a tela de detalhamento (`detalharVinculoAction`) precisa
 * responder "por que a fatura X não está somando aqui?" — sem isso, a linha
 * simplesmente sumiria da lista sem explicação, que é justamente a pergunta que
 * a tela existe pra responder. `linhasExclusivasDoVinculo` continua sendo a
 * porta de entrada de quem só quer a soma (push.ts), implementada em cima
 * desta — as duas NUNCA podem divergir, então há uma implementação só.
 */
export function particionarPorReivindicacao<T extends { servicoOuPlano: string }>(
  linhas: T[],
  vinculoAtual: VinculoAtivo,
  outrosAtivosDaMesmaCategoria: VinculoAtivo[],
): ParticaoPorReivindicacao<T> {
  const precedeVinculoAtual = (outro: VinculoAtivo): boolean => {
    const diff = outro.criadoEm.getTime() - vinculoAtual.criadoEm.getTime();
    if (diff !== 0) return diff < 0;
    return outro.id < vinculoAtual.id;
  };

  const incluidas: T[] = [];
  const excluidas: Array<LinhaReivindicada<T>> = [];
  for (const linha of linhas) {
    const dono = outrosAtivosDaMesmaCategoria.find(
      (outro) =>
        outro.id !== vinculoAtual.id &&
        precedeVinculoAtual(outro) &&
        bateAlgumPadrao(linha.servicoOuPlano, outro.padroes),
    );
    if (dono) excluidas.push({ linha, reivindicadaPor: dono });
    else incluidas.push(linha);
  }
  return { incluidas, excluidas };
}
