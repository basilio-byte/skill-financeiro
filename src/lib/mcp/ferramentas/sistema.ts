import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ferramenta, type Ferramenta } from "../tipos";
import { limite } from "./comum";

/**
 * FERRAMENTAS DE SISTEMA — integridade dos dados, esquema do banco e o rastro do
 * próprio MCP. Todas somente leitura. É o que ajuda a ANALISAR o funcionamento do
 * painel sem abrir o console do Easypanel (ADR-0033).
 */

const verificarIntegridade = ferramenta({
  nome: "verificar_integridade",
  titulo: "Verificar integridade dos dados",
  descricao:
    "Roda verificações de consistência sobre as linhas de receita e devolve, para cada uma, se passou, quantas violações e exemplos: linhas sem data de crédito, mesCredito diferente da data, valores negativos, faturas cuja soma num mês difere do valor da fatura (possível dupla contagem), e quanto há em 'Sem Categoria'. " +
    "Use para saber se o BANCO está saudável (não se o Conexa mudou — isso exige uma sincronização, hoje bloqueada pelo captcha). Passe `mes` (yyyy-MM) para restringir.",
  entrada: z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use yyyy-MM").optional() }),
  somenteLeitura: true,
  executar: async ({ mes }) => {
    const filtro = mes ? Prisma.sql`AND "mesCredito" = ${mes}` : Prisma.empty;

    const semData = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM revenue_categorized_lines WHERE "dataCredito" IS NULL ${filtro}`;
    const mesDivergente = await prisma.$queryRaw<Array<{ crConexaId: number; mesCredito: string; dataCredito: Date }>>`
      SELECT "crConexaId", "mesCredito", "dataCredito" FROM revenue_categorized_lines
      WHERE "dataCredito" IS NOT NULL AND "mesCredito" <> to_char("dataCredito", 'YYYY-MM') ${filtro} LIMIT 10`;
    const mesDivergenteN = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM revenue_categorized_lines
      WHERE "dataCredito" IS NOT NULL AND "mesCredito" <> to_char("dataCredito", 'YYYY-MM') ${filtro}`;
    const negativos = await prisma.$queryRaw<Array<{ crConexaId: number; valor: string }>>`
      SELECT "crConexaId", "valorRecebidoCat"::text AS valor FROM revenue_categorized_lines
      WHERE "valorRecebidoCat" < 0 ${filtro} LIMIT 10`;
    const somaDifere = await prisma.$queryRaw<Array<{ crConexaId: number; mesCredito: string; soma: string; totalDaFatura: string; revisada: boolean; linhas: bigint }>>`
      SELECT "crConexaId", "mesCredito", SUM("valorRecebidoCat")::text AS soma, MAX("valorRecebidoTotal")::text AS "totalDaFatura",
             BOOL_OR("revisadoManualmente") AS revisada, count(*)::bigint AS linhas
      FROM revenue_categorized_lines WHERE true ${filtro}
      GROUP BY "crConexaId", "mesCredito"
      HAVING abs(SUM("valorRecebidoCat") - MAX("valorRecebidoTotal")) > 0.02
      ORDER BY abs(SUM("valorRecebidoCat") - MAX("valorRecebidoTotal")) DESC LIMIT 15`;
    const somaDifereN = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM (
        SELECT 1 FROM revenue_categorized_lines WHERE true ${filtro}
        GROUP BY "crConexaId", "mesCredito"
        HAVING abs(SUM("valorRecebidoCat") - MAX("valorRecebidoTotal")) > 0.02) t`;
    const semCat = await prisma.$queryRaw<Array<{ n: bigint; total: string | null }>>`
      SELECT count(*)::bigint AS n, SUM("valorRecebidoCat")::text AS total FROM revenue_categorized_lines
      WHERE categoria = 'Sem Categoria' ${filtro}`;

    const n = (r: Array<{ n: bigint }>) => Number(r[0]?.n ?? 0);
    const checks = [
      { nome: "linhas_sem_data_de_credito", ok: n(semData) === 0, violacoes: n(semData), exemplos: [] as unknown[], leitura: "Não deveria existir: run.ts descarta CR sem data antes de categorizar." },
      { nome: "mes_de_credito_difere_da_data", ok: n(mesDivergenteN) === 0, violacoes: n(mesDivergenteN), exemplos: mesDivergente, leitura: "O mês faz parte da identidade da linha (ADR-0029); divergência cria linha duplicada na próxima rodada." },
      { nome: "valores_negativos", ok: negativos.length === 0, violacoes: negativos.length, exemplos: negativos, leitura: "Receita negativa só faz sentido como estorno; confirme." },
      {
        nome: "soma_do_mes_difere_do_valor_da_fatura",
        ok: n(somaDifereN) === 0,
        violacoes: n(somaDifereN),
        exemplos: somaDifere.map((s) => ({ ...s, linhas: Number(s.linhas) })),
        leitura: "Possível dupla contagem (linha manual + automática). Se `revisada` é true, pode ser correção humana legítima. Veja listar_conflitos.",
      },
    ];
    return {
      escopo: mes ?? "todos os meses",
      passou: checks.every((c) => c.ok),
      checks,
      semCategoria: { linhas: n(semCat), total: semCat[0]?.total ?? "0.00", leitura: "Não é violação: é o que falta mapear (servicos_sem_categoria)." },
    };
  },
});

const descreverBanco = ferramenta({
  nome: "descrever_banco",
  titulo: "Descrever o banco",
  descricao:
    "O esquema do banco do painel: tabelas, colunas (nome, tipo, se aceita nulo) e a contagem ESTIMADA de linhas. Só metadados, nunca dados de linha. Use para entender onde algo é guardado antes de pedir uma consulta, ou para conferir se uma migration foi aplicada. Passe `tabela` para ver uma só.",
  entrada: z.object({ tabela: z.string().regex(/^[a-z0-9_]+$/, "nome de tabela em minúsculas").optional() }),
  somenteLeitura: true,
  executar: async ({ tabela }) => {
    const filtro = tabela ? Prisma.sql`AND c.table_name = ${tabela}` : Prisma.empty;
    const colunas = await prisma.$queryRaw<Array<{ tabela: string; coluna: string; tipo: string; nulo: string }>>`
      SELECT c.table_name AS tabela, c.column_name AS coluna, c.data_type AS tipo, c.is_nullable AS nulo
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ${filtro}
      ORDER BY c.table_name, c.ordinal_position`;
    const contagens = await prisma.$queryRaw<Array<{ tabela: string; linhas: bigint }>>`
      SELECT relname AS tabela, n_live_tup::bigint AS linhas FROM pg_stat_user_tables`;
    const est = new Map(contagens.map((c) => [c.tabela, Number(c.linhas)]));
    const por = new Map<string, Array<{ coluna: string; tipo: string; aceitaNulo: boolean }>>();
    for (const c of colunas) {
      const l = por.get(c.tabela) ?? [];
      l.push({ coluna: c.coluna, tipo: c.tipo, aceitaNulo: c.nulo === "YES" });
      por.set(c.tabela, l);
    }
    if (tabela && por.size === 0) throw new Error(`Tabela "${tabela}" não existe. Chame descrever_banco sem argumento para listar.`);
    return {
      tabelas: [...por.entries()].map(([nome, cols]) => ({ nome, linhasEstimadas: est.get(nome) ?? null, colunas: cols })),
      migrationsAplicadas: (await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5`).map((m) => m.migration_name),
    };
  },
});

const auditoriaMcp = ferramenta({
  nome: "auditoria_mcp",
  titulo: "Auditoria do MCP",
  descricao:
    "O rastro das chamadas ao MCP: quem, qual ferramenta, quando, com quais argumentos e o resultado. Nas ESCRITAS, `detalhe` guarda o estado ANTERIOR (a linha excluída, o valor antigo): é o que permite desfazer. Use para responder 'quem mudou isto?'.",
  entrada: z.object({
    apenasEscritas: z.boolean().default(true),
    ferramenta: z.string().optional(),
    limite: limite(200, 30),
  }),
  somenteLeitura: true,
  executar: async (a) => {
    const rows = await prisma.auditoriaMcp.findMany({
      where: { ...(a.apenasEscritas ? { escrita: true } : {}), ...(a.ferramenta ? { ferramenta: a.ferramenta } : {}) },
      orderBy: { quando: "desc" },
      take: a.limite,
    });
    return { total: rows.length, chamadas: rows };
  },
});

export const ferramentasDeSistema: Ferramenta[] = [verificarIntegridade, descreverBanco, auditoriaMcp];
