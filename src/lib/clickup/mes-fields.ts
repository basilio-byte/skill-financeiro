/**
 * Resolve quais campos customizados de uma lista do ClickUp são os 12 campos
 * de mês (Janeiro..Dezembro) — sem depender de rede, para ser testável.
 * Ver src/lib/clickup/client.ts para quem chama isto contra a API real.
 */

export interface ClickUpField {
  id: string;
  name: string;
  type: string;
}

// Variantes EXATAS aceitas do nome de cada mês (sem acento, minúsculo), mês 1..12.
// Casar por PREFIXO de 3 letras (versão anterior) foi rejeitado por revisão
// adversarial (2026-07-27): um campo currency real chamado, por exemplo,
// "Novidades", "Setor Comercial" ou "Margem" também bate num prefixo de 3
// letras de mês ("nov", "set", "mar") e roubaria o lugar do campo de mês de
// verdade, sem erro nenhum — dinheiro real seria escrito no campo errado.
// Cada mês só casa com sua grafia correta OU uma variante EXPLICITAMENTE
// conhecida (nunca um prefixo genérico) — nova variante exige alguém adicionar
// aqui de propósito, depois de confirmar que é mesmo o mesmo campo.
const VARIANTES_MES: readonly string[][] = [
  ["janeiro"],
  ["fevereiro"],
  ["marco"],
  ["abril"],
  ["maio"],
  ["junho"],
  ["julho"],
  ["agosto"],
  ["setembro"],
  ["outubro"],
  ["novembro", "novembo"], // "Novembo" (sem o R) é o nome real na lista "Eficiência", achado em produção 2026-07-27.
  ["dezembro"],
];

const MARCA_DIACRITICA_MIN = 0x0300;
const MARCA_DIACRITICA_MAX = 0x036f;

/** Remove acentos (decompondo em NFD e descartando as marcas combinantes) e caixa. */
function normalizarNome(nome: string): string {
  const semAcento = Array.from(nome.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < MARCA_DIACRITICA_MIN || code > MARCA_DIACRITICA_MAX;
    })
    .join("");
  return semAcento.trim().toLowerCase();
}

/**
 * Casa por NOME EXATO (após normalizar acento/caixa) contra uma das variantes
 * conhecidas de cada mês — nunca por prefixo nem por posição na lista de
 * campos (ver VARIANTES_MES acima para o motivo). Só considera campos do tipo
 * "currency" — os outros 17 campos da lista (dropdowns, fórmulas,
 * relacionamentos) nunca são alvo de escrita.
 */
export function resolverCamposPorMes(fields: ClickUpField[]): Record<number, string> {
  const camposPorMes: Record<number, string> = {};
  for (const field of fields) {
    if (field.type !== "currency") continue;
    const nome = normalizarNome(field.name);
    const mesIndex = VARIANTES_MES.findIndex((variantes) => variantes.includes(nome));
    if (mesIndex === -1) continue;
    const mes = mesIndex + 1;
    // Mais de um campo currency batendo na mesma variante é ambiguidade real
    // da lista — o primeiro encontrado vence, nunca escolhido "melhor" às cegas.
    if (!(mes in camposPorMes)) camposPorMes[mes] = field.id;
  }
  return camposPorMes;
}
