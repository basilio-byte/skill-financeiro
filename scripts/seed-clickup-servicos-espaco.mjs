/**
 * Cria os vínculos ClickUp de Serviços de Espaço (Ayrton Senna, Sebrae, Seaway
 * Center) — pedido do usuário 2026-07-28, mesma leva de trabalho de Salas
 * Privativas/SeaBox/Meu Depósito. Diferente de Salas Privativas (contratos
 * mensais de 1 sala), "Serviços de Espaço" é uso avulso/pacote de horas de
 * salas de reunião, atendimento e auditório — bem mais linhas combinadas
 * (fatura de 1 cliente somando várias salas/pacotes numa linha só).
 *
 * Mapeamento sala->tarefa gerado cruzando o dropdown "Nome da sala" de cada
 * tarefa real da lista "Eficiência" contra os `servicoOuPlano` reais de cada
 * categoria "Serviços de Espaço - X", confirmado por 2 investigações
 * independentes. Ver docs/context/decisions.md (seção "SeaBox e demais
 * categorias") para o relato completo, incluindo:
 *  - "[SEAWAY] - Cabine": o dropdown da tarefa diz "Cabine 01", mas o texto
 *    real da fatura é só "Cabine" (sem sufixo) — usamos um padrão MANUAL sem
 *    o "01" em vez do valor exato do dropdown. Só existe 1 tarefa de cabine,
 *    então não há risco de ambiguidade nisso.
 *  - "Pacote de Horas": tarefa genérica (sem sala específica) que hoje só
 *    bateria com faturas que dizem literalmente "Pacote de horas" — por
 *    decisão do usuário, ganhou 2 padrões extras ("Horas do Plano
 *    Contratado", "PH -") pra cobrir variantes de nome do mesmo tipo de
 *    produto (hora avulsa) que apareciam como ~27% das linhas de Seaway
 *    Center sem vínculo nenhum.
 *  - "[SEBRAE] Auditório do Sebrae" (tarefa 86ah8wa55): confirmada como
 *    órfã/duplicada (bate com ZERO linhas reais em qualquer categoria) —
 *    propositalmente FORA do mapeamento abaixo.
 *
 * ORDEM IMPORTA dentro de Seaway Center: salas específicas vêm antes de
 * "Pacote de Horas" no MAPEAMENTO — numa linha combinada (sala + pacote de
 * horas no mesmo texto), a sala específica processa primeiro e fica com o
 * vínculo; "Pacote de Horas" só recolhe o que sobra (linhas puramente de
 * hora avulsa, sem nome de sala nenhum).
 *
 * Duplica aqui em JS puro a mesma lógica de `src/lib/text-normalize.ts` e
 * `src/lib/clickup/filtro-padroes.ts` (normalizarTexto/bateAlgumPadrao/
 * acharSobreposicoes) — scripts standalone não passam pelo bundler/alias do
 * Next.
 *
 * Sobreposição esperada e ampla aqui: ~29% das 59 linhas de Seaway Center
 * combinam 2+ salas/produtos na mesma fatura. A checagem abaixo cria só a
 * PRIMEIRA tarefa processada de cada grupo que colidir — as demais ficam sem
 * vínculo automático pra aquela linha específica (mesmo tradeoff aceito em
 * Salas Privativas/Meu Depósito, não um bug novo).
 *
 * IDEMPOTENTE: já existe vínculo pra essa clickUpTaskId? Pula. Rodar de novo
 * não duplica nada.
 *
 * Rodar em produção via Console do Easypanel: node scripts/seed-clickup-servicos-espaco.mjs
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

const LISTA_ID = "901326339447";
// Atenção: os nomes de categoria abaixo têm o espaçamento EXATO como gravado
// no banco (Ayrton Senna e Sebrae com 2 espaços após o hífen, Seaway Center
// com 1 só) — mesmo achado de Salas Privativas, preservado aqui de propósito.
const MAPEAMENTO = [
  { categoria: "Serviços de Espaço -  Ayrton Senna", padroes: ["[AYRTON SENNA] - SALA DE REUNIÃO 02"], clickUpTaskId: "86agr5z3j" },

  { categoria: "Serviços de Espaço -  Sebrae", padroes: ["[SEBRAE] - SALA DE REUNIÃO ARIANO"], clickUpTaskId: "86agr6akn" },
  { categoria: "Serviços de Espaço -  Sebrae", padroes: ["[SEBRAE] - AUDITÓRIO EMPREENDA"], clickUpTaskId: "86agr6adj" },

  // Salas específicas primeiro (ver nota de ORDEM acima).
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - AUDITÓRIO"], clickUpTaskId: "86ah5p2u2" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE ATENDIMENTO 01"], clickUpTaskId: "86ag3vh71" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE ATENDIMENTO 02"], clickUpTaskId: "86ag3vh79" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE ATENDIMENTO 03"], clickUpTaskId: "86ag3vh7p" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE ATENDIMENTO 04"], clickUpTaskId: "86ah1y9qu" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE ATENDIMENTO 05"], clickUpTaskId: "86ah1y9yv" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE REUNIÃO 01"], clickUpTaskId: "86ag3vh7w" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE REUNIÃO 02"], clickUpTaskId: "86ag3vh4m" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE REUNIÃO 03"], clickUpTaskId: "86ag3vh4w" },
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE REUNIÃO 04"], clickUpTaskId: "86ag3vhbx" },
  // Cabine: padrão manual sem o "01" (ver cabeçalho) — texto real da fatura
  // não tem o sufixo que o dropdown da tarefa tem.
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - Cabine"], clickUpTaskId: "86ah5p1xw" },
  // Sala de Treinamento: tarefa real existe, sem fatura ainda no período
  // investigado — cadastrada agora pra já cobrir quando surgir.
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["[SEAWAY] - SALA DE TREINAMENTO"], clickUpTaskId: "86ah8wamw" },
  // Genérica, por último de propósito (ver ORDEM no cabeçalho). 3 padrões =
  // mesmo produto (hora avulsa) com nomes diferentes no Conexa, decisão do
  // usuário 2026-07-28 (mesmo mecanismo já usado pra Comércio/Comercio).
  { categoria: "Serviços de Espaço - Seaway Center", padroes: ["Pacote de horas", "Horas do Plano Contratado", "PH -"], clickUpTaskId: "86ahrqqh6" },
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
      where: { categoria: item.categoria },
      select: { servicoOuPlano: true },
    });
    const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, item.padroes));

    const outrosVinculos = await prisma.clickUpVinculo.findMany({
      where: { categoria: item.categoria, ativo: true },
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
        `[seed-servicos-espaco] PULADO "${item.padroes.join(", ")}" (${item.categoria}) — a linha "${colisao.linha}" ` +
          `já pertence ao vínculo da tarefa ${colisao.outro.clickUpTaskId} (padrões: ${colisao.outro.padroes.join(", ")}).`,
      );
      pulados++;
      continue;
    }

    if (linhasQueBatem.length === 0) semHistorico++;

    await prisma.clickUpVinculo.create({
      data: {
        categoria: item.categoria,
        padroes: item.padroes,
        clickUpListId: LISTA_ID,
        clickUpTaskId: item.clickUpTaskId,
      },
    });
    console.log(
      `[seed-servicos-espaco] criado: "${item.padroes.join(", ")}" (${item.categoria}) -> tarefa ${item.clickUpTaskId}` +
        (linhasQueBatem.length === 0 ? " [sem fatura no histórico ainda]" : ` [${linhasQueBatem.length} linha(s) histórica(s)]`),
    );
    criados++;
  }

  console.log(
    `\n[seed-servicos-espaco] resumo: ${criados} criado(s), ${jaExistiam} já existiam (idempotente), ` +
      `${pulados} pulado(s) por sobreposição, ${semHistorico} criado(s) sem histórico ainda (aviso, não bloqueio).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-servicos-espaco] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
