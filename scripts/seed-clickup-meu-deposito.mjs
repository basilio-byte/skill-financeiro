/**
 * Cria os vínculos ClickUp de Meu Depósito (10 boxes) — pedido do usuário
 * 2026-07-28, mesma leva de trabalho de Salas Privativas/SeaBox.
 *
 * Mapeamento box->tarefa gerado a partir do dropdown "Nome da sala" de cada
 * tarefa real da lista "Eficiência" (ex. "Contrato: Meu Depósito 06"),
 * confirmado por 2 investigações independentes. Ver docs/context/decisions.md
 * (seção "SeaBox e demais categorias") para o relato completo.
 *
 * Duplica aqui em JS puro a mesma lógica de `src/lib/text-normalize.ts` e
 * `src/lib/clickup/filtro-padroes.ts` (normalizarTexto/bateAlgumPadrao) —
 * scripts standalone não passam pelo bundler/alias do Next.
 *
 * Achado da investigação que este script já leva em conta: 2 pares de boxes
 * (04+05, 08+10) aparecem SEMPRE combinados na mesma linha de fatura (cliente
 * alugando os 2 de uma vez, valor único pros 2 juntos) — exatamente o mesmo
 * padrão de sobreposição já visto em Salas Privativas. A checagem abaixo
 * detecta isso e cria só o PRIMEIRO de cada par (a ordem em MAPEAMENTO decide
 * qual): o outro fica sem vínculo automático até a fatura ser lançada separada
 * por box (risco aceito, mesmo tradeoff documentado em Salas Privativas — não
 * dá pra dividir o valor de uma linha combinada sem inventar dado).
 *
 * IDEMPOTENTE: já existe vínculo pra essa clickUpTaskId? Pula. Rodar de novo
 * não duplica nada.
 *
 * Rodar em produção via Console do Easypanel: node scripts/seed-clickup-meu-deposito.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MARCA_DIACRITICA_MIN = 0x0300;
const MARCA_DIACRITICA_MAX = 0x036f;

function normalizarTexto(texto) {
  const semAcento = Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < MARCA_DIACRITICA_MIN || code > MARCA_DIACRITICA_MAX;
    })
    .join("");
  return semAcento.trim().toLowerCase().replace(/\s+/g, " ");
}

function bateAlgumPadrao(servicoOuPlano, padroes) {
  const alvo = normalizarTexto(servicoOuPlano);
  return padroes.some((padrao) => alvo.includes(normalizarTexto(padrao)));
}

const CATEGORIA = "Meu Depósito";
const LISTA_ID = "901326339447";
const MAPEAMENTO = [
  { padroes: ["Meu Depósito 02"], clickUpTaskId: "86ag3vguk" },
  { padroes: ["Meu Depósito 03"], clickUpTaskId: "86ag3vgvk" },
  { padroes: ["Meu Depósito 04"], clickUpTaskId: "86ag3vgvq" },
  { padroes: ["Meu Depósito 05"], clickUpTaskId: "86ag3vgw5" },
  { padroes: ["Meu Depósito 06"], clickUpTaskId: "86ag3vgu2" },
  { padroes: ["Meu Depósito 07"], clickUpTaskId: "86ag3vguz" },
  { padroes: ["Meu Depósito 08"], clickUpTaskId: "86ag3vgtu" },
  { padroes: ["Meu Depósito 10"], clickUpTaskId: "86ag3vgth" },
  // 01 e 09: tarefa real existe no ClickUp, mas sem fatura ainda no período
  // investigado — cadastrados agora pra já cobrir quando surgir.
  { padroes: ["Meu Depósito 01"], clickUpTaskId: "86ag3vgv5" },
  { padroes: ["Meu Depósito 09"], clickUpTaskId: "86ag3vgwc" },
];

async function main() {
  let criados = 0;
  let jaExistiam = 0;
  let semHistorico = 0;
  let comSobreposicao = 0;

  for (const item of MAPEAMENTO) {
    const jaTem = await prisma.clickUpVinculo.findUnique({ where: { clickUpTaskId: item.clickUpTaskId } });
    if (jaTem) {
      jaExistiam++;
      continue;
    }

    const linhasDaCategoria = await prisma.revenueCategorizedLine.findMany({
      where: { categoria: CATEGORIA },
      select: { servicoOuPlano: true },
    });
    const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, item.padroes));

    const outrosVinculos = await prisma.clickUpVinculo.findMany({
      where: { categoria: CATEGORIA, ativo: true },
      select: { id: true, clickUpTaskId: true, padroes: true },
    });
    let colisao = null;
    for (const linha of linhasQueBatem) {
      const outro = outrosVinculos.find((o) => bateAlgumPadrao(linha.servicoOuPlano, o.padroes));
      if (outro) {
        colisao = { linha: linha.servicoOuPlano, outro };
        break;
      }
    }
    // ATÉ A ADR-0028 isto PULAVA a criação (sem detalhe por item, dois vínculos
    // casando a mesma linha dobrariam o valor). Agora o push divide item a
    // item, então criar é seguro E é o certo — cada box recebe a parte dele em
    // vez de o valor inteiro ficar com o vizinho. Vira só um aviso.
    if (colisao) {
      console.log(
        `[seed-deposito] AVISO "${item.padroes.join(", ")}" — a linha "${colisao.linha}" também casa o ` +
          `vínculo da tarefa ${colisao.outro.clickUpTaskId}. Com a divisão por item (ADR-0028) cada box recebe ` +
          `só a sua parte.`,
      );
      comSobreposicao++;
    }

    if (linhasQueBatem.length === 0) semHistorico++;

    await prisma.clickUpVinculo.create({
      data: {
        categoria: CATEGORIA,
        padroes: item.padroes,
        clickUpListId: LISTA_ID,
        clickUpTaskId: item.clickUpTaskId,
      },
    });
    console.log(
      `[seed-deposito] criado: "${item.padroes.join(", ")}" -> tarefa ${item.clickUpTaskId}` +
        (linhasQueBatem.length === 0 ? " [sem fatura no histórico ainda]" : ` [${linhasQueBatem.length} linha(s) histórica(s)]`),
    );
    criados++;
  }

  console.log(
    `\n[seed-deposito] resumo: ${criados} criado(s), ${jaExistiam} já existiam (idempotente), ` +
      `${comSobreposicao} criado(s) com linha compartilhada (push divide por item), ${semHistorico} criado(s) sem histórico ainda (aviso, não bloqueio).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-deposito] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
