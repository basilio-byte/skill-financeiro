/**
 * Cria os vínculos ClickUp de SeaBox (Básico/Pro) — pedido do usuário
 * 2026-07-28, mesma leva de trabalho de Salas Privativas.
 *
 * Diferente de Salas Privativas (que casa por "Nome da sala", um dropdown por
 * sala física), SeaBox são 2 tarefas sem "Nome da sala" preenchido — o campo
 * usado aqui é "TIPO DE PRODUTO" ("SeaBox Básico"/"SeaBox Pro"), e só é seguro
 * porque cada um desses 2 valores aparece em EXATAMENTE 1 tarefa entre as 152
 * da lista "Eficiência" (confirmado por 2 investigações independentes,
 * incluindo checagem de que não colide com valores repetidos tipo "Sala de
 * reunião"/"Auditório"/"ONE"). Ver docs/context/decisions.md (seção "SeaBox e
 * demais categorias") para o relato completo.
 *
 * Duplica aqui em JS puro a mesma lógica de `src/lib/text-normalize.ts` e
 * `src/lib/clickup/filtro-padroes.ts` (normalizarTexto/bateAlgumPadrao) —
 * scripts standalone não passam pelo bundler/alias do Next, mesmo motivo de
 * outros scripts deste diretório.
 *
 * Sem risco de sobreposição: nenhuma linha de "SeaBox" no banco combina mais
 * de um produto na mesma fatura (confirmado, nenhum ";" em servicoOuPlano
 * dessa categoria) — a checagem abaixo existe só por consistência com os
 * demais scripts desta série, nunca deve disparar aqui.
 *
 * IDEMPOTENTE: já existe vínculo pra essa clickUpTaskId? Pula. Rodar de novo
 * não duplica nada.
 *
 * Rodar em produção via Console do Easypanel: node scripts/seed-clickup-seabox.mjs
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

const CATEGORIA = "SeaBox";
const LISTA_ID = "901326339447";
const MAPEAMENTO = [
  { padroes: ["SeaBox Básico"], clickUpTaskId: "86ahap3f8" },
  { padroes: ["SeaBox Pro"], clickUpTaskId: "86ahapayk" },
];

async function main() {
  let criados = 0;
  let jaExistiam = 0;
  let semHistorico = 0;
  let pulados = 0;

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
    if (colisao) {
      console.log(
        `[seed-seabox] PULADO "${item.padroes.join(", ")}" — a linha "${colisao.linha}" já pertence ao ` +
          `vínculo da tarefa ${colisao.outro.clickUpTaskId} (padrões: ${colisao.outro.padroes.join(", ")}).`,
      );
      pulados++;
      continue;
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
      `[seed-seabox] criado: "${item.padroes.join(", ")}" -> tarefa ${item.clickUpTaskId}` +
        (linhasQueBatem.length === 0 ? " [sem fatura no histórico ainda]" : ` [${linhasQueBatem.length} linha(s) histórica(s)]`),
    );
    criados++;
  }

  console.log(
    `\n[seed-seabox] resumo: ${criados} criado(s), ${jaExistiam} já existiam (idempotente), ` +
      `${pulados} pulado(s) por sobreposição, ${semHistorico} criado(s) sem histórico ainda (aviso, não bloqueio).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-seabox] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
