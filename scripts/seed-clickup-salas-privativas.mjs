/**
 * Cria os vínculos ClickUp de Salas Privativas (Ayrton Senna, Sebrae, Seaway
 * Center) — pedido do usuário 2026-07-28. Mapeamento sala->tarefa gerado
 * PROGRAMATICAMENTE (não digitado à mão): cruzou o valor do dropdown "Nome
 * da sala" de cada tarefa real da lista "Eficiência" (que espelha o nome do
 * contrato da Conexa, ex. "Contrato: Sala 03 - Ayrton Senna") contra os
 * `servicoOuPlano` reais de cada categoria "Salas Privativas - X" no banco.
 * Ver docs/context/decisions.md (ADR-0024, seção "Salas Privativas") para o
 * relato completo da investigação.
 *
 * Duplica aqui em JS puro a mesma lógica de `src/lib/text-normalize.ts` e
 * `src/lib/clickup/filtro-padroes.ts` (normalizarTexto/bateAlgumPadrao/
 * acharSobreposicoes) — scripts standalone não passam pelo bundler/alias do
 * Next, mesmo motivo de outros scripts deste diretório. Qualquer mudança
 * nessas funções em src/ precisa ser replicada aqui.
 *
 * Achados da investigação que este script já leva em conta:
 *  - 5 salas com receita real (Loja 05/11/12/13/14) e mais 2 (Estação 05 -
 *    Coworking L21, "Coworking Estação 08") NÃO têm tarefa correspondente no
 *    ClickUp ainda — ficam de fora do mapeamento abaixo até alguém criar a
 *    tarefa lá.
 *  - Faturas que combinam várias salas numa linha só (Sebrae 08+09+10 numa
 *    linha, Seaway 06+07-Loja24 noutra) fariam DOIS vínculos somarem o MESMO
 *    valor se eu criasse um pra cada sala — a checagem de sobreposição
 *    abaixo detecta isso e pula a segunda (e seguintes), nunca cria os dois.
 *
 * IDEMPOTENTE: já existe vínculo pra essa clickUpTaskId? Pula. Rodar de novo
 * não duplica nada.
 *
 * Rodar em produção via Console do Easypanel: node scripts/seed-clickup-salas-privativas.mjs
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

// Mapeamento verificado (ver cabeçalho) — categoria + padrão único (1 sala) +
// a tarefa real do ClickUp que representa essa sala.
const LISTA_ID = "901326339447";
const MAPEAMENTO = [
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 10 - Ayrton Senna", clickUpTaskId: "86agx96me" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 02 - Ayrton Senna", clickUpTaskId: "86agx9bbc" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Estação 03 Sala 07 - Ayrton Senna", clickUpTaskId: "86agx8hxw" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 14 Ayrton Senna", clickUpTaskId: "86agx8y6n" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 04 - Ayrton Senna", clickUpTaskId: "86agx6q7n" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 13 - Ayrton Senna", clickUpTaskId: "86agx6quz" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 16 - Ayrton Senna", clickUpTaskId: "86ah1xd3h" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Estação 02 Sala 07 - Ayrton Senna", clickUpTaskId: "86ah1xcq2" },
  { categoria: "Salas Privativas -  Ayrton Senna", padrao: "Sala 05 - Ayrton Senna", clickUpTaskId: "86agx8v7t" },

  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 10 - Sebrae", clickUpTaskId: "86agr6bkf" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 09 - Sebrae", clickUpTaskId: "86agr6bhj" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 08 - Sebrae", clickUpTaskId: "86agr6bg8" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 06 - Sebrae", clickUpTaskId: "86agr6bd1" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 02 - Sebrae", clickUpTaskId: "86agr6b6z" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 01 - Sebrae", clickUpTaskId: "86agr6aux" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 05 - Sebrae", clickUpTaskId: "86agr6bat" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 04 - Sebrae", clickUpTaskId: "86agr6b9t" },
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 07 - Sebrae", clickUpTaskId: "86agr6bf6" },
  // Sala 03 - Sebrae: sem fatura ainda no período investigado, mas a tarefa
  // real existe no ClickUp — cadastrada agora pra já cobrir quando surgir.
  { categoria: "Salas Privativas -  Sebrae", padrao: "Sala 03 - Sebrae", clickUpTaskId: "86agr6b8k" },

  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 05 - Loja 24", clickUpTaskId: "86ag3vhng" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Estação 06 - Coworking L21", clickUpTaskId: "86ag3vhkt" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 07 - Loja 24", clickUpTaskId: "86ag3vhr6" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 06 - Loja 24", clickUpTaskId: "86ag3vhpp" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Estação 10 - Coworking L21", clickUpTaskId: "86ag3vhjx" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 08 - Loja 24", clickUpTaskId: "86ag3vhqf" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 02 - Loja 21", clickUpTaskId: "86ag3vhmp" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 04 - Loja 26", clickUpTaskId: "86ag3vhuh" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Estação 01 - Coworking L21", clickUpTaskId: "86ag3vhk4" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 03 - Loja 26", clickUpTaskId: "86ag3vhv1" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 02 - Loja 30", clickUpTaskId: "86agx78dk" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 10 - Loja 26", clickUpTaskId: "86ag3vhxj" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 10 - Loja 24", clickUpTaskId: "86ag3vhpa" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 08 - Loja 26", clickUpTaskId: "86ag3vhwp" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 01 - Loja 30", clickUpTaskId: "86agx7t1y" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Estação de estudo 02 - Loja 08", clickUpTaskId: "86ah5p9xb" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 01 - Loja 28", clickUpTaskId: "86ag3vhzv" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 03 - Loja 21", clickUpTaskId: "86ag3vhme" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 04 - Loja 24", clickUpTaskId: "86ag3vht1" },
  { categoria: "Salas Privativas - Seaway Center", padrao: "Sala 07 - Loja 26", clickUpTaskId: "86ag3vhwb" },
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
    const linhasQueBatem = linhasDaCategoria.filter((l) => bateAlgumPadrao(l.servicoOuPlano, [item.padrao]));

    // Sobreposição: alguma dessas linhas já pertence a outro vínculo ATIVO
    // (incluindo os que este mesmo script já criou nesta execução)?
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
        `[seed-salas] PULADO "${item.padrao}" (${item.categoria}) — a linha "${colisao.linha}" já pertence ao ` +
          `vínculo da tarefa ${colisao.outro.clickUpTaskId} (padrões: ${colisao.outro.padroes.join(", ")}). ` +
          `Criar dobraria o valor empurrado pras duas tarefas — provável fatura combinando várias salas.`,
      );
      pulados++;
      continue;
    }

    if (linhasQueBatem.length === 0) semHistorico++;

    await prisma.clickUpVinculo.create({
      data: {
        categoria: item.categoria,
        padroes: [item.padrao],
        clickUpListId: LISTA_ID,
        clickUpTaskId: item.clickUpTaskId,
      },
    });
    console.log(
      `[seed-salas] criado: "${item.padrao}" (${item.categoria}) -> tarefa ${item.clickUpTaskId}` +
        (linhasQueBatem.length === 0 ? " [sem fatura no histórico ainda]" : ` [${linhasQueBatem.length} linha(s) histórica(s)]`),
    );
    criados++;
  }

  console.log(
    `\n[seed-salas] resumo: ${criados} criado(s), ${jaExistiam} já existiam (idempotente), ` +
      `${pulados} pulado(s) por sobreposição, ${semHistorico} criado(s) sem histórico ainda (aviso, não bloqueio).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-salas] ERRO:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
