import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildXlsx, type Sheet } from "@/lib/xlsx/writer";
import { lerAba, lerPartes, lerPasta, lerXml, nomesDasAbas } from "@/lib/xlsx/inspecionar";
import { APP_TZ } from "@/lib/dates";
import { csvDaAba, lerCsv } from "@/lib/exportacao/csv";
import { entregar } from "@/lib/exportacao/empacotar";
import { LIMITE_CELULA } from "@/lib/exportacao/texto";
import { ExportacaoGrandeDemaisError, ExportacaoInconsistenteError, ExportacaoNegadaError, MAX_LINHAS, type ColunaDef, type Formato } from "@/lib/exportacao/tipos";
import {
  ABAS_ACESSOS,
  COLUNAS_ACESSOS,
  COLUNAS_CONTAS,
  COLUNAS_EXPORTACOES,
  COLUNAS_MCP,
  COLUNAS_TOKENS,
  IDS_ABAS_ACESSOS,
  SELECT_ACESSO,
  SELECT_CONTA,
  SELECT_EXPORTACAO,
  SELECT_MCP,
  SELECT_TOKEN,
  abaAcessosPermitida,
  abasDoFormato,
  conferirContagemExataDoArquivo,
  conferirContraBancoAcessos,
  descreverPedidoAcessos,
  filtroDeTempo,
  filtrosJsonAcessos,
  intervaloDosEventos,
  lerPedidoAcessos,
  montarAbasAcessos,
  nomeDoArquivoAcessos,
  paraLinhaAcesso,
  paraLinhaConta,
  paraLinhaExportacao,
  paraLinhaMcp,
  paraLinhaToken,
  rotuloEscopo,
  rotuloPapel,
  titulosDaAba,
  validarPermissoesAcessos,
  verificarTeto,
  type AbaAcessos,
  type DadosAcessos,
  type LinhaAcesso,
  type LinhaConta,
  type LinhaExportacao,
  type LinhaMcp,
  type LinhaToken,
  type PedidoAcessos,
  type ReferenciaBancoAcessos,
} from "@/lib/exportacao/pasta-acessos";

const serialHoraDeParede = (paredeIso: string): string => {
  const ms = Date.parse(paredeIso);
  const dias = Math.floor(ms / 86_400_000);
  return String(dias + 25_569 + (ms - dias * 86_400_000) / 86_400_000);
};

/**
 * Os registros abaixo têm o formato do que o Prisma devolve com os SELECT_* (datas são INSTANTES). Os segredos são
 * strings reconhecíveis: o teste procura por elas no arquivo inteiro.
 */
const SEGREDOS = {
  senha: "$2a$12$HASHdaSENHAqueNUNCAdeveSAIR.AbCdEfGhIjKlMnOpQrStUvWxYz012",
  tokenHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  tokenPleno: "shf_TOKEN_PLENO_QUE_NUNCA_SAI_0123456789abcdef",
  argumentos: "123.456.789-09",
  detalhe: "12.345.678/0001-90",
} as const;
const PROIBIDOS = Object.values(SEGREDOS);

const dec = (s: string) => new Decimal(s);

const CONTA_ADMIN = { name: "Ana Admin", email: "ana@seahub.com.br", role: "ADMIN", isActive: true, createdAt: new Date("2026-07-21T16:22:12Z"), lastLoginAt: new Date("2026-11-04T20:00:00Z") };
const CONTA_VIEWER = { name: "Vera Viewer", email: "vera@seahub.com.br", role: "VIEWER", isActive: false, createdAt: new Date("2026-08-01T12:00:00Z"), lastLoginAt: null };

const ACESSO_OK = { createdAt: new Date("2026-11-04T20:00:05Z"), email: "ana@seahub.com.br", success: true, reason: null, ip: "177.10.20.30", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130" };
const ACESSO_FALHA = { createdAt: new Date("2026-11-04T19:59:10Z"), email: "ninguem@x.com", success: false, reason: "usuário inexistente", ip: "::1", userAgent: null };

const MCP_LEITURA = { quando: new Date("2026-11-04T21:26:09Z"), quem: "ana@seahub.com.br via MCP (Claude Code)", ferramenta: "panorama", escrita: false, resultado: "ok", erro: null, duracaoMs: 84 };
const MCP_ESCRITA = { quando: new Date("2026-11-04T21:30:00Z"), quem: "ana@seahub.com.br via MCP (Claude Code)", ferramenta: "excluir_linha", escrita: true, resultado: "erro", erro: "linha não encontrada", duracaoMs: 0 };

const TOKEN_ATIVO = {
  nome: "Claude Code do notebook",
  prefixo: "shf_4mF6lt",
  escopo: "LEITURA",
  criadoEm: new Date("2026-11-04T20:23:26Z"),
  ultimoUsoEm: new Date("2026-11-04T21:25:59Z"),
  revogadoEm: null,
  user: { name: "Ana Admin", email: "ana@seahub.com.br" },
};
const TOKEN_REVOGADO = { ...TOKEN_ATIVO, nome: "Token antigo", prefixo: "shf_Zz9Yy8", escopo: "ESCRITA", ultimoUsoEm: null, revogadoEm: new Date("2026-11-05T12:00:00Z") };

const EXP_RECEITA = { quando: new Date("2026-11-04T20:50:44Z"), quem: "Ana Admin (ana@seahub.com.br)", papel: "ADMIN", conjunto: "receita", formato: "xlsx", linhas: 1234, total: dec("45678.9"), dadosPessoais: true, resultado: "ok", erro: null, resumoFiltros: "Período: 01/10/2026 a 31/10/2026" };
const EXP_FALHA = { ...EXP_RECEITA, quando: new Date("2026-11-04T20:55:00Z"), conjunto: "inadimplencia", linhas: 0, total: null, dadosPessoais: false, resultado: "erro", erro: "O recorte tem 25.000 cobranças.", resumoFiltros: null };
const EXP_CENTAVOS_1 = { ...EXP_RECEITA, quando: new Date("2026-11-04T21:00:00Z"), conjunto: "regras", linhas: 3, total: dec("0.1"), dadosPessoais: false, resumoFiltros: "x" };
const EXP_CENTAVOS_2 = { ...EXP_CENTAVOS_1, quando: new Date("2026-11-04T21:01:00Z"), papel: "VIEWER", total: dec("0.2") };

const dados = (): DadosAcessos => ({
  contas: [CONTA_ADMIN, CONTA_VIEWER].map(paraLinhaConta),
  acessos: [ACESSO_OK, ACESSO_FALHA].map(paraLinhaAcesso),
  mcp: [MCP_LEITURA, MCP_ESCRITA].map(paraLinhaMcp),
  tokens: [TOKEN_ATIVO, TOKEN_REVOGADO].map(paraLinhaToken),
  exportacoes: [EXP_RECEITA, EXP_FALHA, EXP_CENTAVOS_1, EXP_CENTAVOS_2].map(paraLinhaExportacao),
});

/** O que o banco diria sobre os dados acima — escrito à mão, não derivado do código que está sendo testado. */
const REF: ReferenciaBancoAcessos = {
  contas: { contagem: 2, ativas: 1, administradores: 1 },
  acessos: { contagem: 2, sucessos: 1 },
  mcp: { contagem: 2, escritas: 1 },
  tokens: { contagem: 2, revogados: 1, comEscrita: 1 },
  // 45678,90 + 0,10 + 0,20 (a exportação que falhou não tem valor). Nota: este teste NÃO distingue soma em float de soma
  // em decimal — a soma é arredondada em centavos no fim, o que esconde o ruído de float em poucas parcelas de 2 casas. A
  // garantia contra float é estrutural (só `sum`/`money`/`toFixed` de Decimal) e a do VALOR DA CÉLULA é testada abaixo
  // ("45678.90", com o zero), que um Number() quebraria.
  exportacoes: { contagem: 4, valor: "45679.20", comDadosPessoais: 1 },
};

const ADMIN = { id: "u1", nome: "Admin de Teste", email: "admin@teste.local", papel: "ADMIN" as const };
const VIEWER = { id: "u2", nome: "Visualizador", email: "viewer@teste.local", papel: "VIEWER" as const };
const GERADO_EM = new Date("2026-11-04T20:00:00Z");

const pedido = (params: Record<string, string | string[]> = {}): PedidoAcessos => lerPedidoAcessos(params).pedido;
const montar = (p: PedidoAcessos = pedido(), d: DadosAcessos = dados(), formato: Formato = "xlsx") =>
  montarAbasAcessos({ dados: d, pedido: p, formato, geradoEm: GERADO_EM, usuario: ADMIN });
const leiaMe = (abas: Sheet[]) =>
  lerAba(buildXlsx(abas), "Leia-me")
    .linhas.map((r) => r.join(" | "))
    .join("\n");

/** Todo o texto de um arquivo: cada parte do ZIP (abas, estilos, workbook) e o CSV de cada aba. */
function textoDeTudo(abas: Sheet[]): string {
  const partes = [...lerPartes(buildXlsx(abas)).values()].map((b) => b.toString("utf8"));
  const csvs = abas.map((a) => csvDaAba(a).texto);
  return [...partes, ...csvs].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------

describe("lerPedidoAcessos", () => {
  it("sem parâmetros: todas as abas, sem datas e sem erros", () => {
    const { pedido: p, erros } = lerPedidoAcessos({});
    expect(erros).toEqual([]);
    expect(p).toEqual({ de: null, ate: null, abas: ["contas", "acessos", "mcp", "tokens", "exportacoes"] });
  });

  it("f=1: só as abas marcadas, SEMPRE na ordem do catálogo (a primeira é a principal)", () => {
    const { pedido: p, erros } = lerPedidoAcessos({ f: "1", abas: ["tokens", "acessos"] });
    expect(erros).toEqual([]);
    expect(p.abas).toEqual(["acessos", "tokens"]);
    expect(lerPedidoAcessos({ f: "1", abas: ["exportacoes", "contas", "contas"] }).pedido.abas).toEqual(["contas", "exportacoes"]);
  });

  it("f=1 sem nenhuma aba é um pedido VAZIO (erro), nunca 'todas' em silêncio", () => {
    expect(lerPedidoAcessos({ f: "1" }).erros).toEqual(["Escolha ao menos uma aba para o arquivo."]);
    expect(lerPedidoAcessos({ f: "1", de: "2026-11-01" }).erros).toContain("Escolha ao menos uma aba para o arquivo.");
  });

  it("sem formulário (link direto), as abas pedidas valem do mesmo jeito", () => {
    expect(lerPedidoAcessos({ abas: "mcp" }).pedido.abas).toEqual(["mcp"]);
  });

  it("aba desconhecida vira erro e a mensagem não repete texto gigante", () => {
    const { erros } = lerPedidoAcessos({ f: "1", abas: ["senhas", "contas"] });
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatch(/Aba desconhecida: "senhas"\. Use contas, acessos, mcp, tokens, exportacoes\./);
    const longa = lerPedidoAcessos({ abas: "x".repeat(500) }).erros[0]!;
    expect(longa.length).toBeLessThan(150);
  });

  it("data malformada, inexistente ou invertida vira ERRO (filtro ignorado entregaria o histórico inteiro)", () => {
    expect(lerPedidoAcessos({ de: "04/11/2026" }).erros[0]).toMatch(/Data inicial inválida/);
    expect(lerPedidoAcessos({ ate: "2026-02-31" }).erros[0]).toMatch(/Data final inválida/);
    expect(lerPedidoAcessos({ de: "2026-11-05", ate: "2026-11-04" }).erros).toContain("A data inicial é depois da final.");
    expect(lerPedidoAcessos({ de: "1999-01-01" }).erros[0]).toMatch(/Data inicial inválida/);
  });

  it("data com só abas de ESTADO (Contas/Tokens) é erro: o filtro não teria efeito nenhum", () => {
    const e = lerPedidoAcessos({ f: "1", abas: ["contas", "tokens"], de: "2026-11-01" }).erros;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/só valem para as abas de eventos/);
    expect(lerPedidoAcessos({ f: "1", abas: ["contas", "acessos"], de: "2026-11-01" }).erros).toEqual([]);
    expect(lerPedidoAcessos({ f: "1", abas: ["contas", "tokens"] }).erros).toEqual([]);
  });

  it("datas válidas são guardadas como vieram (aaaa-mm-dd)", () => {
    const { pedido: p, erros } = lerPedidoAcessos({ de: "2026-11-01", ate: "2026-11-04" });
    expect(erros).toEqual([]);
    expect(p).toMatchObject({ de: "2026-11-01", ate: "2026-11-04" });
  });
});

describe("datas no fuso do app (de/até, 'até' inclusivo)", () => {
  // Natal/RN = America/Fortaleza = UTC-3, sem horário de verão: a meia-noite local é 03:00 UTC.
  it("o fuso padrão do app é o de Natal (é o que estes testes supõem)", () => {
    expect(APP_TZ).toBe("America/Fortaleza");
  });

  it("de/ate viram instantes: meia-noite de 'de' e meia-noite do dia SEGUINTE a 'ate'", () => {
    const iv = intervaloDosEventos({ de: "2026-11-01", ate: "2026-11-04" });
    expect(iv.gte?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(iv.lt?.toISOString()).toBe("2026-11-05T03:00:00.000Z");
  });

  it("'ate' é inclusivo: o último milissegundo do dia entra e a meia-noite seguinte não; 'de' idem", () => {
    const iv = intervaloDosEventos({ de: "2026-11-01", ate: "2026-11-04" });
    const dentro = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= iv.gte!.getTime() && t < iv.lt!.getTime();
    };
    expect(dentro("2026-11-05T02:59:59.999Z")).toBe(true); // 23:59:59.999 de 04/11 em Natal
    expect(dentro("2026-11-05T03:00:00.000Z")).toBe(false); // 00:00 de 05/11 em Natal
    expect(dentro("2026-11-01T03:00:00.000Z")).toBe(true); // 00:00 de 01/11 em Natal
    expect(dentro("2026-11-01T02:59:59.999Z")).toBe(false); // 23:59:59.999 de 31/10 em Natal
    // um login às 22h de Natal (01h UTC do dia seguinte) é do dia de Natal, não do dia UTC
    expect(dentro("2026-11-05T01:00:00.000Z")).toBe(true);
  });

  it("virada de mês, de ano e fevereiro bissexto", () => {
    expect(intervaloDosEventos({ de: null, ate: "2026-10-31" }).lt?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(intervaloDosEventos({ de: null, ate: "2026-12-31" }).lt?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(intervaloDosEventos({ de: null, ate: "2028-02-28" }).lt?.toISOString()).toBe("2028-02-29T03:00:00.000Z");
    expect(intervaloDosEventos({ de: null, ate: "2026-02-28" }).lt?.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("um dia só (de = ate) cobre exatamente 24 horas", () => {
    const iv = intervaloDosEventos({ de: "2026-11-04", ate: "2026-11-04" });
    expect(iv.lt!.getTime() - iv.gte!.getTime()).toBe(24 * 3_600_000);
  });

  it("filtroDeTempo: sem datas não filtra; só uma ponta filtra só a ponta", () => {
    expect(filtroDeTempo(intervaloDosEventos({ de: null, ate: null }))).toBeUndefined();
    expect(Object.keys(filtroDeTempo(intervaloDosEventos({ de: "2026-11-01", ate: null }))!)).toEqual(["gte"]);
    expect(Object.keys(filtroDeTempo(intervaloDosEventos({ de: null, ate: "2026-11-01" }))!)).toEqual(["lt"]);
    expect(Object.keys(filtroDeTempo(intervaloDosEventos({ de: "2026-11-01", ate: "2026-11-02" }))!).sort()).toEqual(["gte", "lt"]);
  });
});

describe("permissões (tudo aqui é dado pessoal: só administrador)", () => {
  it("toda aba é só de administrador", () => {
    expect(ABAS_ACESSOS.every((a) => a.somenteAdmin)).toBe(true);
    expect(abaAcessosPermitida("acessos", "VIEWER")).toBe(false);
    expect(abaAcessosPermitida("acessos", "ADMIN")).toBe(true);
    expect(abaAcessosPermitida("inventada", "ADMIN")).toBe(false);
  });

  it.each(IDS_ABAS_ACESSOS)("visualizador pedindo a aba %s é RECUSADO (ExportacaoNegadaError), não atendido pela metade", (id) => {
    const p = pedido({ f: "1", abas: id });
    expect(() => validarPermissoesAcessos(p, VIEWER)).toThrow(ExportacaoNegadaError);
    expect(() => validarPermissoesAcessos(p, VIEWER)).toThrow(/administradores/);
    expect(() => validarPermissoesAcessos(p, ADMIN)).not.toThrow();
  });

  it("administrador pede qualquer combinação", () => {
    expect(() => validarPermissoesAcessos(pedido(), ADMIN)).not.toThrow();
  });
});

describe("catálogo de colunas", () => {
  const tudo: Array<[AbaAcessos, ColunaDef<never>[]]> = [
    ["contas", COLUNAS_CONTAS as ColunaDef<never>[]],
    ["acessos", COLUNAS_ACESSOS as ColunaDef<never>[]],
    ["mcp", COLUNAS_MCP as ColunaDef<never>[]],
    ["tokens", COLUNAS_TOKENS as ColunaDef<never>[]],
    ["exportacoes", COLUNAS_EXPORTACOES as ColunaDef<never>[]],
  ];

  it("os títulos de cada aba são os da especificação, na ordem", () => {
    expect(titulosDaAba("contas")).toEqual(["Nome", "E-mail", "Papel", "Ativa", "Criada em", "Último acesso"]);
    expect(titulosDaAba("acessos")).toEqual(["Quando", "E-mail informado", "Sucesso", "Motivo", "IP", "Navegador (user agent)"]);
    expect(titulosDaAba("mcp")).toEqual(["Quando", "Quem", "Ferramenta", "Escrita", "Resultado", "Erro", "Duração (ms)"]);
    expect(titulosDaAba("tokens")).toEqual(["Nome do token", "Prefixo visível", "Escopo", "Usuário dono", "Criado em", "Último uso", "Revogado em"]);
    expect(titulosDaAba("exportacoes")).toEqual([
      "Quando", "Quem", "Papel", "Conjunto", "Formato", "Linhas", "Valor total do arquivo", "Dados pessoais", "Resultado", "Erro", "Filtros (resumo)",
    ]);
  });

  it("ids de coluna únicos por aba, e cada coluna pertence à própria aba", () => {
    for (const [aba, colunas] of tudo) {
      const ids = colunas.map((c) => c.id);
      expect(new Set(ids).size, aba).toBe(ids.length);
      for (const c of colunas) expect(c.grupo).toBe(aba);
    }
  });

  /** Proxy que registra cada propriedade lida: a coluna só pode ler o que declara em `campos` (e tudo o que declara). */
  function espiao<L extends object>(linha: L) {
    const lidos = new Set<string>();
    const p = new Proxy(linha, {
      get(alvo, prop) {
        lidos.add(String(prop));
        return (alvo as Record<string, unknown>)[String(prop)];
      },
    });
    return { p, lidos };
  }

  function verificarCampos<L extends object>(aba: string, colunas: ColunaDef<L>[], completa: L) {
    for (const c of colunas) {
      const { p, lidos } = espiao(completa);
      c.valor(p);
      expect([...lidos].sort(), `${aba}.${c.id}`).toEqual([...c.campos].sort());
      for (const f of c.campos) expect(Object.keys(completa), `${aba}.${c.id} → ${f}`).toContain(f);
    }
  }

  it("cada coluna lê SÓ os campos que declara — e todos eles (nenhuma coluna lê um campo escondido)", () => {
    verificarCampos("contas", COLUNAS_CONTAS, paraLinhaConta(CONTA_ADMIN));
    verificarCampos("acessos", COLUNAS_ACESSOS, paraLinhaAcesso(ACESSO_OK));
    verificarCampos("mcp", COLUNAS_MCP, paraLinhaMcp(MCP_ESCRITA));
    verificarCampos("tokens", COLUNAS_TOKENS, paraLinhaToken(TOKEN_ATIVO));
    verificarCampos("exportacoes", COLUNAS_EXPORTACOES, paraLinhaExportacao(EXP_RECEITA));
  });

  it("nenhuma coluna, campo ou título é de segredo (senha, hash, argumentos, detalhe)", () => {
    for (const [aba, colunas] of tudo) {
      for (const c of colunas) {
        expect(c.titulo, `${aba}.${c.id}`).not.toMatch(/senha|hash|argumento|detalhe/i);
        for (const f of c.campos) expect(["passwordHash", "hash", "argumentos", "detalhe", "token"], `${aba}.${c.id}.${f}`).not.toContain(f);
      }
    }
  });

  it("a leitura do banco é estreita: os SELECT_* NÃO pedem hash de senha, hash de token, argumentos nem detalhe", () => {
    const todos = { SELECT_CONTA, SELECT_ACESSO, SELECT_MCP, SELECT_TOKEN, SELECT_EXPORTACAO } as Record<string, Record<string, unknown>>;
    for (const [nome, sel] of Object.entries(todos)) {
      for (const proibido of ["passwordHash", "hash", "argumentos", "detalhe", "token", "revogadoPor"]) {
        expect(Object.keys(sel), `${nome} pede ${proibido}`).not.toContain(proibido);
      }
    }
    expect(Object.keys(SELECT_CONTA).sort()).toEqual(["createdAt", "email", "isActive", "lastLoginAt", "name", "role"]);
    expect(Object.keys(SELECT_MCP).sort()).toEqual(["duracaoMs", "erro", "escrita", "ferramenta", "quando", "quem", "resultado"]);
    // o dono do token vem pela relação, só com nome e e-mail (a relação User tem o passwordHash)
    expect(SELECT_TOKEN.user).toEqual({ select: { name: true, email: true } });
  });
});

/**
 * O código do servidor (`acessos.ts`) é `server-only` e não pode ser importado por um teste. Estas travas leem o TEXTO
 * dele (sem os comentários) e garantem as três regras que a leitura do banco precisa cumprir: só colunas estreitas
 * (SELECT_*), só leitura e nenhum nome de segredo. Não substituem a verificação contra o banco — protegem contra uma
 * edição futura descuidada (um `findMany()` sem `select` traria o hash da senha para a memória).
 */
describe("o código do servidor só lê, e só pelas colunas estreitas", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./acessos.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("o módulo é server-only", () => {
    expect(fonte.trimStart().startsWith('import "server-only"')).toBe(true);
  });

  it("todo findMany passa um select SELECT_* (um por aba) e nada usa include nem SQL cru", () => {
    expect(fonte.match(/\.findMany\(/g)).toHaveLength(5);
    expect((fonte.match(/select: SELECT_[A-Z]+/g) ?? []).sort()).toEqual([
      "select: SELECT_ACESSO",
      "select: SELECT_CONTA",
      "select: SELECT_EXPORTACAO",
      "select: SELECT_MCP",
      "select: SELECT_TOKEN",
    ]);
    expect(fonte).not.toMatch(/\binclude\s*:/);
    expect(fonte).not.toMatch(/\$(queryRaw|executeRaw)(Unsafe)?/);
  });

  it("SOMENTE LEITURA: nenhuma escrita no banco (create, update, upsert, delete e suas versões em lote)", () => {
    expect(fonte).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });

  it("nenhum nome de segredo no código (fora dos comentários)", () => {
    for (const proibido of ["passwordHash", "argumentos", "detalhe"]) expect(fonte).not.toContain(proibido);
    expect(fonte).not.toMatch(/\bhash\b/i);
  });

  it("a checagem de papel é a primeira coisa do gerador, antes de qualquer acesso ao banco", () => {
    const corpo = fonte.slice(fonte.indexOf("export async function gerarExportacaoAcessos"));
    expect(corpo.indexOf("validarPermissoesAcessos(pedido, usuario)")).toBeGreaterThan(-1);
    expect(corpo.indexOf("validarPermissoesAcessos(pedido, usuario)")).toBeLessThan(corpo.indexOf("prisma."));
  });
});

describe("do banco para a linha", () => {
  it("copia campo a campo: um campo a mais no registro de origem NÃO passa", () => {
    const contaSuja = { ...CONTA_ADMIN, passwordHash: SEGREDOS.senha, hash: SEGREDOS.tokenHash };
    expect(Object.keys(paraLinhaConta(contaSuja)).sort()).toEqual(["ativa", "criadaEm", "email", "nome", "papel", "ultimoAcesso"]);
    const mcpSujo = { ...MCP_ESCRITA, argumentos: { cpf: SEGREDOS.argumentos }, detalhe: { cnpj: SEGREDOS.detalhe } };
    expect(Object.keys(paraLinhaMcp(mcpSujo)).sort()).toEqual(["duracaoMs", "erro", "escrita", "ferramenta", "quando", "quem", "resultado"]);
    const tokenSujo = { ...TOKEN_ATIVO, hash: SEGREDOS.tokenHash, token: SEGREDOS.tokenPleno, user: { ...TOKEN_ATIVO.user, passwordHash: SEGREDOS.senha } };
    expect(Object.keys(paraLinhaToken(tokenSujo)).sort()).toEqual(["criadoEm", "dono", "escopo", "nome", "prefixo", "revogadoEm", "ultimoUso"]);
    expect(JSON.stringify(paraLinhaToken(tokenSujo))).not.toContain(SEGREDOS.senha);
    expect(JSON.stringify(paraLinhaToken(tokenSujo))).not.toContain(SEGREDOS.tokenHash);
  });

  it("as datas viram relógio de parede de Natal (20:00 UTC = 17:00), e nulo continua nulo", () => {
    const c = paraLinhaConta(CONTA_ADMIN);
    expect(c.ultimoAcesso?.toISOString()).toBe("2026-11-04T17:00:00.000Z"); // os campos UTC carregam o relógio de parede
    expect(paraLinhaConta(CONTA_VIEWER).ultimoAcesso).toBeNull();
    expect(paraLinhaToken(TOKEN_ATIVO).revogadoEm).toBeNull();
  });

  it("o dono do token é 'Nome (e-mail)'", () => {
    expect(paraLinhaToken(TOKEN_ATIVO).dono).toBe("Ana Admin (ana@seahub.com.br)");
  });

  it("o valor da exportação sai do Decimal como string exata (nunca float) e nulo continua nulo", () => {
    expect(paraLinhaExportacao(EXP_RECEITA).valor).toBe("45678.90");
    expect(paraLinhaExportacao(EXP_CENTAVOS_1).valor).toBe("0.10");
    expect(paraLinhaExportacao(EXP_FALHA).valor).toBeNull();
  });

  it("rótulos: papel e escopo em português; valor desconhecido sai como veio (e 'constructor' não vira função)", () => {
    expect(rotuloPapel("ADMIN")).toBe("Administrador");
    expect(rotuloPapel("VIEWER")).toBe("Visualizador");
    expect(rotuloPapel("SUPER")).toBe("SUPER");
    expect(rotuloPapel("constructor")).toBe("constructor");
    expect(rotuloEscopo("LEITURA")).toBe("Somente leitura");
    expect(rotuloEscopo("ESCRITA")).toBe("Leitura e escrita");
    expect(rotuloEscopo("__proto__")).toBe("__proto__");
  });
});

describe("montarAbasAcessos", () => {
  it("abas: Leia-me e as escolhidas, na ordem do catálogo; a principal é a primeira escolhida", () => {
    const s = montar();
    expect(s.abas.map((a) => a.name)).toEqual(["Leia-me", "Contas", "Acessos", "Auditoria do MCP", "Tokens do MCP", "Exportações"]);
    expect(s.principal).toBe("Contas");

    const parcial = montar(pedido({ f: "1", abas: ["exportacoes", "acessos"] }), { acessos: dados().acessos, exportacoes: dados().exportacoes });
    expect(parcial.abas.map((a) => a.name)).toEqual(["Leia-me", "Acessos", "Exportações"]);
    expect(parcial.principal).toBe("Acessos");
  });

  it("um EsperadoNaAba por aba de dados (as não escolhidas não existem no arquivo)", () => {
    const s = montar();
    expect(s.esperado.map((e) => e.nomeAba)).toEqual(["Contas", "Acessos", "Auditoria do MCP", "Tokens do MCP", "Exportações"]);
    expect(s.esperado.map((e) => e.nLinhas)).toEqual([2, 2, 2, 2, 4]);
    expect(s.esperado.every((e) => e.indiceValor === -1 && e.total === null)).toBe(true);
    expect(s.esperado[2]!.titulos).toEqual(titulosDaAba("mcp"));
    expect(s.nLinhas).toBe(12);
    expect(s.linhasPorAba.map((l) => `${l.nome}=${l.linhas}`)).toEqual(["Contas=2", "Acessos=2", "Auditoria do MCP=2", "Tokens do MCP=2", "Exportações=4"]);
  });

  it("no CSV só a aba principal é montada (e as outras nem precisam ter sido lidas)", () => {
    const s = montar(pedido({ f: "1", abas: ["acessos", "mcp"] }), { acessos: dados().acessos }, "csv");
    expect(s.abas.map((a) => a.name)).toEqual(["Leia-me", "Acessos"]);
    expect(s.principal).toBe("Acessos");
    expect(s.esperado).toHaveLength(1);
    expect(abasDoFormato(pedido({ f: "1", abas: ["acessos", "mcp"] }), "csv")).toEqual(["acessos"]);
    expect(abasDoFormato(pedido({ f: "1", abas: ["acessos", "mcp"] }), "xlsx")).toEqual(["acessos", "mcp"]);
  });

  it("cabeçalho e linhas de cada aba, lidos de volta do arquivo", () => {
    const buf = buildXlsx(montar().abas);
    expect(nomesDasAbas(buf)).toEqual(["Leia-me", "Contas", "Acessos", "Auditoria do MCP", "Tokens do MCP", "Exportações"]);
    const contas = lerAba(buf, "Contas").linhas;
    expect(contas[0]).toEqual(titulosDaAba("contas"));
    // Números de série do Excel, derivados à mão (não copiados do código): 15/09/2026 = 46280.
    //  - Ana criada 21/07/2026 16:22:12Z = 13:22:12 em Natal: 46280 − 56 dias = 46224; 48132 s / 86400 = 0,55708333
    //  - Vera criada 01/08/2026 12:00:00Z = 09:00 em Natal: 46280 − 45 dias = 46235; 9/24 = 0,375
    //  - último acesso de Ana 04/11/2026 20:00Z = 17:00: 46330; 17/24 = 0,70833333
    // O gerador grava a fração do dia com a precisão do double (sem cortar em 8 casas), então compara-se o NÚMERO.
    const [ana, vera] = contas.slice(1);
    expect(ana!.slice(0, 4)).toEqual(["Ana Admin", "ana@seahub.com.br", "Administrador", "Sim"]);
    expect(Number(ana![4])).toBeCloseTo(46224.55708333, 8);
    expect(Number(ana![5])).toBeCloseTo(46330.70833333, 8);
    expect(vera!.slice(0, 4)).toEqual(["Vera Viewer", "vera@seahub.com.br", "Visualizador", "Não"]);
    expect(Number(vera![4])).toBeCloseTo(46235.375, 8);
    expect(vera![5]).toBe("");
    for (const id of IDS_ABAS_ACESSOS) {
      const aba = ABAS_ACESSOS.find((a) => a.id === id)!;
      expect(lerAba(buf, aba.nome).linhas[0], aba.nome).toEqual(titulosDaAba(id));
    }
  });

  it("Sim/Não, escopo e papel em português; evento e estado no mesmo arquivo", () => {
    const buf = buildXlsx(montar().abas);
    const acessos = lerAba(buf, "Acessos").linhas;
    expect(acessos[1]).toEqual([serialHoraDeParede("2026-11-04T17:00:05Z"), "ana@seahub.com.br", "Sim", "", "177.10.20.30", "Mozilla/5.0 (Windows NT 10.0) Chrome/130"]);
    expect(acessos[2]![2]).toBe("Não");
    expect(acessos[2]![3]).toBe("usuário inexistente");
    expect(acessos[2]![4]).toBe("::1");
    expect(acessos[2]![5]).toBe(""); // sem user agent: célula em branco, nunca "null"
    const mcp = lerAba(buf, "Auditoria do MCP").linhas;
    expect(mcp[1]![3]).toBe("Não");
    expect(mcp[2]![3]).toBe("Sim");
    expect(mcp[2]![4]).toBe("erro");
    const tokens = lerAba(buf, "Tokens do MCP").linhas;
    expect(tokens[1]![2]).toBe("Somente leitura");
    expect(tokens[2]![2]).toBe("Leitura e escrita");
    expect(tokens[1]![6]).toBe(""); // ativo: sem data de revogação
    expect(tokens[2]![6]).not.toBe("");
  });

  it("data e hora são data e hora de verdade, no relógio de Natal (20:00:05 UTC = 17:00:05)", () => {
    const buf = buildXlsx(montar().abas);
    // 2026-11-04 = 46330 dias desde 1899-12-30; 17:00:05 = 61205 s de 86400 → 0,70839120
    expect(lerAba(buf, "Acessos").linhas[1]![0]).toBe(serialHoraDeParede("2026-11-04T17:00:05Z"));
    const styles = lerXml(buf, "xl/styles.xml");
    expect(styles).toContain('formatCode="dd/mm/yyyy\\ hh:mm"');
  });

  it("dinheiro é número exato (não texto, não float) e a célula fica vazia onde não há valor", () => {
    const buf = buildXlsx(montar().abas);
    const exp = lerAba(buf, "Exportações").linhas;
    const iValor = titulosDaAba("exportacoes").indexOf("Valor total do arquivo");
    expect(exp.slice(1).map((r) => r[iValor])).toEqual(["45678.90", "", "0.10", "0.20"]);
    // estilo de dinheiro (s=2) só nas células de valor preenchidas, como número (<v>), nunca texto
    const xml = lerXml(buf, "xl/worksheets/sheet6.xml");
    expect(xml).toContain('<c r="G2" s="2"><v>45678.90</v></c>');
    expect(xml).toContain('<c r="G4" s="2"><v>0.10</v></c>');
    expect(xml).not.toContain('<c r="G3" s="2">'); // a exportação que falhou não tem valor: célula vazia
  });

  it("inteiros: duração zero (recusa) aparece como 0, não some; linhas exportadas como inteiro", () => {
    const buf = buildXlsx(montar().abas);
    expect(lerAba(buf, "Auditoria do MCP").linhas[2]![6]).toBe("0");
    expect(lerAba(buf, "Exportações").linhas[1]![5]).toBe("1234");
  });

  it("aba pedida e NÃO lida é defeito (nunca uma aba vazia que parece dizer 'zero eventos')", () => {
    const d = dados();
    delete d.mcp;
    expect(() => montar(pedido(), d)).toThrow(ExportacaoInconsistenteError);
    expect(() => montar(pedido(), d)).toThrow(/Auditoria do MCP.*não foi lida/);
  });

  it("aba sem nenhuma linha: sai só com o cabeçalho, e o Leia-me diz zero", () => {
    const vazio: DadosAcessos = { contas: [], acessos: [], mcp: [], tokens: [], exportacoes: [] };
    const s = montar(pedido(), vazio);
    expect(s.nLinhas).toBe(0);
    const buf = buildXlsx(s.abas);
    expect(lerAba(buf, "Acessos").linhas).toEqual([titulosDaAba("acessos")]);
    expect(leiaMe(s.abas)).toContain("Acessos | 0 (0 falha(s) de login)");
    expect(leiaMe(s.abas)).toContain("Linhas de dados no arquivo | 0");
  });

  it("sem nenhuma aba é erro de programação, não um arquivo vazio", () => {
    expect(() => montar({ de: null, ate: null, abas: [] }, {})).toThrow(ExportacaoInconsistenteError);
  });
});

describe("Leia-me", () => {
  it("diz que são dados pessoais, o que NÃO sai, o recorte, quem gerou e a hora no fuso do app", () => {
    const t = leiaMe(montar().abas);
    expect(t).toContain("Gerado por | Admin de Teste (admin@teste.local)");
    expect(t).toContain("04/11/2026 17:00"); // 20:00Z = 17:00 em Natal
    expect(t).toContain("DADOS PESSOAIS");
    expect(t).toContain("e-mails, endereços IP e navegadores");
    expect(t).toContain("LGPD");
    expect(t).toContain("restrito a administradores");
    expect(t).toContain("senhas (nem o hash delas)");
    expect(t).toContain("nunca o token nem o hash");
    expect(t).toContain("argumentos e o estado anterior");
    expect(t).toContain("CPF/CNPJ");
    expect(t).toContain(`Período dos eventos (fuso de Fortaleza, UTC−3) | todo o histórico (sem filtro de datas)`);
    expect(t).toContain("Abas pedidas | Contas · Acessos · Auditoria do MCP · Tokens do MCP · Exportações");
  });

  it("resultado por aba, com o detalhe que interessa a quem audita", () => {
    const t = leiaMe(montar().abas);
    expect(t).toContain("Contas | 2 (1 ativa(s))");
    expect(t).toContain("Acessos | 2 (1 falha(s) de login)");
    expect(t).toContain("Auditoria do MCP | 2 (1 chamada(s) de escrita)");
    expect(t).toContain("Tokens do MCP | 2 (1 revogado(s))");
    expect(t).toContain("Exportações | 4 (1 com dados pessoais)");
    expect(t).toContain("Linhas de dados no arquivo | 12");
  });

  it("o período aparece quando há datas e a conferência é descrita", () => {
    const p = pedido({ de: "2026-11-01", ate: "2026-11-04" });
    const t = leiaMe(montar(p).abas);
    expect(t).toContain(`Período dos eventos (fuso de Fortaleza, UTC−3) | 01/11/2026 a 04/11/2026`);
    expect(t).toContain("com a data final inclusa");
    expect(t).toContain("Fechamento | OK. A contagem de linhas de cada aba (e, em Exportações, a soma de 'Valor total do arquivo') foi conferida contra o banco");
    expect(leiaMe(montar(pedido({ de: "2026-11-01" })).abas)).toContain("a partir de 01/11/2026");
    expect(leiaMe(montar(pedido({ ate: "2026-11-04" })).abas)).toContain("até 04/11/2026");
  });

  it("avisa que a própria exportação ainda não aparece no registro de exportações", () => {
    expect(leiaMe(montar().abas)).toContain("Esta exportação ainda não aparece nele");
  });

  it("só fala das abas que estão no arquivo", () => {
    const soContas = leiaMe(montar(pedido({ f: "1", abas: "contas" }), { contas: dados().contas }).abas);
    expect(soContas).toContain("Contas: estado de agora, sem filtro de data");
    expect(soContas).toContain("Período dos eventos (fuso de Fortaleza, UTC−3) | não se aplica (nenhuma aba de eventos marcada)");
    expect(soContas).not.toContain("x-forwarded-for");
    expect(soContas).not.toContain("chamada de ferramenta");
    expect(soContas).not.toContain("As datas (de/até) valem");
    expect(soContas).not.toContain("Valor total do arquivo");
    const soAcessos = leiaMe(montar(pedido({ f: "1", abas: "acessos" }), { acessos: dados().acessos }).abas);
    expect(soAcessos).toContain("x-forwarded-for");
    expect(soAcessos).toContain("As datas (de/até) valem");
    expect(soAcessos).not.toContain("Tokens do MCP: revogar");
  });
});

describe("segredos NUNCA saem (mesmo que a linha de origem os traga)", () => {
  /** Registros de origem "sujos": o que um `findMany()` sem `select` traria, com tudo o que não pode sair. */
  const sujos = () => {
    const contaSuja = { ...CONTA_ADMIN, passwordHash: SEGREDOS.senha };
    const tokenSujo = { ...TOKEN_ATIVO, hash: SEGREDOS.tokenHash, token: SEGREDOS.tokenPleno, user: { ...TOKEN_ATIVO.user, passwordHash: SEGREDOS.senha } };
    const mcpSujo = { ...MCP_ESCRITA, argumentos: { cpf: SEGREDOS.argumentos }, detalhe: { linhaExcluida: { cnpj: SEGREDOS.detalhe } } };
    const acessoSujo = { ...ACESSO_OK, passwordHash: SEGREDOS.senha };
    const exportacaoSuja = { ...EXP_RECEITA, filtros: { cliente: SEGREDOS.argumentos } };
    return { contaSuja, tokenSujo, mcpSujo, acessoSujo, exportacaoSuja };
  };

  function semSegredos(texto: string, onde: string) {
    for (const s of PROIBIDOS) expect(texto.includes(s), `${onde}: o segredo ${s.slice(0, 12)}… apareceu no arquivo`).toBe(false);
  }

  it("1) registro do banco com campos a mais → mapeadores → arquivo: nenhum segredo em NENHUMA parte do .xlsx nem do CSV", () => {
    const s = sujos();
    const d: DadosAcessos = {
      contas: [paraLinhaConta(s.contaSuja)],
      acessos: [paraLinhaAcesso(s.acessoSujo)],
      mcp: [paraLinhaMcp(s.mcpSujo)],
      tokens: [paraLinhaToken(s.tokenSujo)],
      exportacoes: [paraLinhaExportacao(s.exportacaoSuja)],
    };
    const texto = textoDeTudo(montar(pedido(), d).abas);
    semSegredos(texto, "mapeadores");
    // a varredura NÃO é vazia: o prefixo visível do token (permitido) e o nome da ferramenta estão lá
    expect(texto).toContain("shf_4mF6lt");
    expect(texto).toContain("excluir_linha");
  });

  it("2) linha JÁ mapeada com campos de segredo grudados (um spread descuidado no futuro): as colunas não os leem", () => {
    const d: DadosAcessos = {
      contas: [{ ...paraLinhaConta(CONTA_ADMIN), passwordHash: SEGREDOS.senha } as unknown as LinhaConta],
      acessos: [{ ...paraLinhaAcesso(ACESSO_OK), passwordHash: SEGREDOS.senha } as unknown as LinhaAcesso],
      mcp: [{ ...paraLinhaMcp(MCP_ESCRITA), argumentos: SEGREDOS.argumentos, detalhe: SEGREDOS.detalhe } as unknown as LinhaMcp],
      tokens: [{ ...paraLinhaToken(TOKEN_ATIVO), hash: SEGREDOS.tokenHash, token: SEGREDOS.tokenPleno } as unknown as LinhaToken],
      exportacoes: [{ ...paraLinhaExportacao(EXP_RECEITA), filtros: SEGREDOS.argumentos } as unknown as LinhaExportacao],
    };
    semSegredos(textoDeTudo(montar(pedido(), d).abas), "linhas já mapeadas");
  });

  it("3) o arquivo ENTREGUE (comprimido, passando por entregar) e cada CSV também não têm segredo", () => {
    const s = sujos();
    const d: DadosAcessos = {
      contas: [paraLinhaConta(s.contaSuja)],
      acessos: [paraLinhaAcesso(s.acessoSujo)],
      mcp: [paraLinhaMcp(s.mcpSujo)],
      tokens: [paraLinhaToken(s.tokenSujo)],
      exportacoes: [paraLinhaExportacao(s.exportacaoSuja)],
    };
    const p = pedido();
    const pasta = montar(p, d);
    const xlsx = entregar(pasta.abas, pasta.esperado, "xlsx", pasta.principal);
    semSegredos([...lerPartes(xlsx.buffer).values()].map((b) => b.toString("utf8")).join("\n"), "xlsx entregue");
    for (const id of IDS_ABAS_ACESSOS) {
      const so = pedido({ f: "1", abas: id });
      const pc = montar(so, d, "csv");
      const csv = entregar(pc.abas, pc.esperado, "csv", pc.principal);
      semSegredos(csv.buffer.toString("utf8"), `CSV ${id}`);
    }
  });

  it("a varredura enxerga um segredo que vazasse por um campo PERMITIDO (prova que ela não é vazia)", () => {
    const d = dados();
    d.mcp = [{ ...paraLinhaMcp(MCP_ESCRITA), erro: `falhou com ${SEGREDOS.tokenPleno}` }];
    const texto = textoDeTudo(montar(pedido(), d).abas);
    expect(texto).toContain(SEGREDOS.tokenPleno);
  });
});

describe("texto hostil", () => {
  const hostil = {
    ...ACESSO_OK,
    email: '=HYPERLINK("http://evil.example","clique")',
    ip: "+55 84 99999-0000",
    userAgent: "Mozilla <script>alert(1)</script> & \"aspas\" 'apóstrofo' \u0008\u0000 controle 😀 acentuação ção",
  };
  const comHostil = (): DadosAcessos => ({ acessos: [paraLinhaAcesso(hostil), paraLinhaAcesso({ ...ACESSO_OK, userAgent: "-1", email: "@usuario" })] });
  const p = () => pedido({ f: "1", abas: "acessos" });

  it("caractere de controle sai, markup é escapado e o acento fica (o Excel não abre em modo de reparo)", () => {
    const buf = buildXlsx(montar(p(), comHostil()).abas);
    const linhas = lerAba(buf, "Acessos").linhas;
    expect(linhas[1]![5]).toBe("Mozilla <script>alert(1)</script> & \"aspas\" 'apóstrofo'  controle 😀 acentuação ção");
    const xml = lerXml(buf, "xl/worksheets/sheet2.xml");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("no .xlsx texto que parece fórmula é texto (string inline), nunca fórmula", () => {
    const buf = buildXlsx(montar(p(), comHostil()).abas);
    const xml = lerXml(buf, "xl/worksheets/sheet2.xml");
    expect(xml).not.toContain("<f>");
    expect(xml).toContain('t="inlineStr"');
    expect(lerAba(buf, "Acessos").linhas[1]![1]).toBe('=HYPERLINK("http://evil.example","clique")');
  });

  it("no CSV texto que começa com = + - @ ganha apóstrofo (injeção de fórmula)", () => {
    const pasta = montar(p(), comHostil(), "csv");
    const csv = entregar(pasta.abas, pasta.esperado, "csv", pasta.principal);
    const linhas = lerCsv(csv.buffer.toString("utf8"));
    expect(linhas[1]![1]).toBe(`'=HYPERLINK("http://evil.example","clique")`);
    expect(linhas[1]![4]).toBe("'+55 84 99999-0000");
    expect(linhas[2]![1]).toBe("'@usuario");
    expect(linhas[2]![5]).toBe("'-1");
  });

  it("o nome de quem gerou (texto livre da conta) também é limpo no Leia-me", () => {
    const p1 = pedido({ f: "1", abas: "acessos" });
    const s = montarAbasAcessos({ dados: { acessos: [] }, pedido: p1, formato: "xlsx", geradoEm: GERADO_EM, usuario: { ...ADMIN, nome: "Ana \u0008\u0000 <b>&</b>" } });
    const buf = buildXlsx(s.abas);
    expect(leiaMe(s.abas)).toContain("Gerado por | Ana  <b>&</b> (admin@teste.local)");
    expect(lerXml(buf, "xl/worksheets/sheet1.xml")).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("texto gigante (user agent de 40 mil caracteres) é cortado, de forma marcada, no limite da célula", () => {
    const d: DadosAcessos = { acessos: [paraLinhaAcesso({ ...ACESSO_OK, userAgent: "x".repeat(40_000) })] };
    const buf = buildXlsx(montar(p(), d).abas);
    const t = lerAba(buf, "Acessos").linhas[1]![5]!;
    expect(t.length).toBeLessThanOrEqual(LIMITE_CELULA);
    expect(t).toContain("texto cortado");
  });

  it("quebra de linha dentro do texto não desalinha o CSV (a conferência de leitura de volta fecha)", () => {
    const d: DadosAcessos = { acessos: [paraLinhaAcesso({ ...ACESSO_OK, userAgent: "linha 1\nlinha 2;com ponto e vírgula\r\ne \"aspas\"" }), paraLinhaAcesso(ACESSO_FALHA)] };
    const pasta = montar(p(), d, "csv");
    const csv = entregar(pasta.abas, pasta.esperado, "csv", pasta.principal);
    const linhas = lerCsv(csv.buffer.toString("utf8"));
    expect(linhas).toHaveLength(3);
    expect(linhas[1]![5]).toBe("linha 1\nlinha 2;com ponto e vírgula\r\ne \"aspas\"");
  });
});

describe("conferirContraBancoAcessos (prova que a conferência ACUSA defeito)", () => {
  it("dado íntegro: nenhuma divergência", () => {
    expect(conferirContraBancoAcessos(dados(), REF)).toEqual([]);
  });

  it("acusa leitura truncada (uma linha a menos) em qualquer aba", () => {
    for (const id of IDS_ABAS_ACESSOS) {
      const d = dados();
      (d[id] as unknown[]).pop();
      const p = conferirContraBancoAcessos(d, REF);
      expect(p.some((x) => x.includes("linhas: lido") && x.includes(ABAS_ACESSOS.find((a) => a.id === id)!.nome)), id).toBe(true);
    }
  });

  it("acusa linha a MAIS (duplicada) mesmo quando a conferência de soma não perceberia", () => {
    const d = dados();
    d.tokens!.push({ ...d.tokens![0]! });
    expect(conferirContraBancoAcessos(d, REF).some((x) => x.startsWith("Tokens do MCP, linhas"))).toBe(true);
  });

  it("acusa rótulo invertido (mesma contagem, 'Sim' no lugar de 'Não')", () => {
    const d = dados();
    d.acessos![1] = { ...d.acessos![1]!, sucesso: true };
    expect(conferirContraBancoAcessos(d, REF)).toEqual(["Acessos, logins com sucesso: lido 2 ≠ banco 1"]);

    const e = dados();
    e.mcp![0] = { ...e.mcp![0]!, escrita: true };
    expect(conferirContraBancoAcessos(e, REF).some((x) => x.includes("Auditoria do MCP, escritas"))).toBe(true);

    const c = dados();
    c.contas![1] = { ...c.contas![1]!, papel: "ADMIN" };
    expect(conferirContraBancoAcessos(c, REF).some((x) => x.includes("Contas, administradores"))).toBe(true);

    const a = dados();
    a.contas![0] = { ...a.contas![0]!, ativa: false };
    expect(conferirContraBancoAcessos(a, REF).some((x) => x.includes("Contas, ativas"))).toBe(true);

    const t = dados();
    t.tokens![0] = { ...t.tokens![0]!, escopo: "ESCRITA" };
    expect(conferirContraBancoAcessos(t, REF).some((x) => x.includes("Tokens do MCP, com escrita"))).toBe(true);
    const r = dados();
    r.tokens![0] = { ...r.tokens![0]!, revogadoEm: new Date("2026-11-05T00:00:00Z") };
    expect(conferirContraBancoAcessos(r, REF).some((x) => x.includes("Tokens do MCP, revogados"))).toBe(true);

    const x = dados();
    x.exportacoes![1] = { ...x.exportacoes![1]!, dadosPessoais: true };
    expect(conferirContraBancoAcessos(x, REF).some((y) => y.includes("Exportações, com dados pessoais"))).toBe(true);
  });

  it("acusa UM centavo de diferença na soma dos valores das exportações", () => {
    const d = dados();
    d.exportacoes![0] = { ...d.exportacoes![0]!, valor: "45678.91" };
    const p = conferirContraBancoAcessos(d, REF);
    expect(p).toEqual(['Exportações: soma de "Valor total do arquivo" lida (45679.21) ≠ soma do banco (45679.20)']);
  });

  it("valor nulo conta como zero na soma, e 0,10 + 0,20 fecha com 0,30 (e 0,31 é acusado)", () => {
    const d: DadosAcessos = { exportacoes: [EXP_CENTAVOS_1, EXP_CENTAVOS_2, EXP_FALHA].map(paraLinhaExportacao) };
    expect(conferirContraBancoAcessos(d, { exportacoes: { contagem: 3, valor: "0.30", comDadosPessoais: 0 } })).toEqual([]);
    expect(conferirContraBancoAcessos(d, { exportacoes: { contagem: 3, valor: "0.31", comDadosPessoais: 0 } })).toHaveLength(1);
  });

  it("acusa aba lida sem referência e referência sem aba lida (ninguém conferiu / ninguém leu)", () => {
    const semRef = { ...REF };
    delete semRef.mcp;
    expect(conferirContraBancoAcessos(dados(), semRef)).toEqual(["Auditoria do MCP: lida sem referência do banco para conferir"]);
    const semAba = dados();
    delete semAba.tokens;
    expect(conferirContraBancoAcessos(semAba, REF)).toEqual(["Tokens do MCP: o banco tem referência, mas a aba não foi lida"]);
  });
});

describe("conferência do arquivo lido de volta", () => {
  it("arquivo íntegro: nenhuma divergência", () => {
    const s = montar();
    expect(conferirContagemExataDoArquivo(buildXlsx(s.abas), s.esperado)).toEqual([]);
  });

  it("acusa linha a MAIS no arquivo (coisa que a leitura de volta de entregar() não pega em abas sem soma)", () => {
    const s = montar();
    const acessos = s.abas.find((a) => a.name === "Acessos")!;
    acessos.rows.push(acessos.rows[acessos.rows.length - 1]!);
    expect(conferirContagemExataDoArquivo(buildXlsx(s.abas), s.esperado)).toEqual(["Acessos: o arquivo tem 3 linha(s) de dados, esperado 2"]);
  });

  it("acusa linha a menos e aba que não existe (problema na lista, não exceção)", () => {
    const s = montar();
    const mcp = s.abas.find((a) => a.name === "Auditoria do MCP")!;
    mcp.rows.pop();
    expect(conferirContagemExataDoArquivo(buildXlsx(s.abas), s.esperado)).toEqual(["Auditoria do MCP: o arquivo tem 1 linha(s) de dados, esperado 2"]);
    const semAba = s.abas.filter((a) => a.name !== "Contas");
    const p = conferirContagemExataDoArquivo(buildXlsx(semAba), s.esperado);
    expect(p.some((x) => x.startsWith("Contas: não consegui reler a aba"))).toBe(true);
  });

  it("entregar() xlsx: todas as abas, comprimido, conferido", () => {
    const s = montar();
    const e = entregar(s.abas, s.esperado, "xlsx", s.principal);
    expect(e.extensao).toBe("xlsx");
    expect(nomesDasAbas(e.buffer)).toEqual(["Leia-me", "Contas", "Acessos", "Auditoria do MCP", "Tokens do MCP", "Exportações"]);
    expect(lerPasta(e.buffer).find((a) => a.nome === "Exportações")!.linhas).toHaveLength(5);
  });

  it("entregar() csv: só a aba principal, UTF-8 com BOM, separador ';' e a leitura de volta fecha", () => {
    const s = montar(pedido({ f: "1", abas: ["mcp", "tokens"] }), { mcp: dados().mcp }, "csv");
    const e = entregar(s.abas, s.esperado, "csv", s.principal);
    expect(e.extensao).toBe("csv");
    const texto = e.buffer.toString("utf8");
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    const linhas = lerCsv(texto);
    expect(linhas[0]).toEqual(titulosDaAba("mcp"));
    expect(linhas).toHaveLength(3);
    expect(linhas[1]!.slice(0, 5)).toEqual(["04/11/2026 18:26", "ana@seahub.com.br via MCP (Claude Code)", "panorama", "Não", "ok"]);
    expect(texto).not.toContain("DADOS PESSOAIS"); // o CSV não leva Leia-me
  });

  it("entregar() RECUSA arquivo que não fecha com o esperado (contagem ou cabeçalho errados)", () => {
    const s = montar();
    const contagemErrada = s.esperado.map((e) => (e.nomeAba === "Acessos" ? { ...e, nLinhas: e.nLinhas + 1 } : e));
    expect(() => entregar(s.abas, contagemErrada, "xlsx", s.principal)).toThrow(ExportacaoInconsistenteError);
    const cabecalhoErrado = s.esperado.map((e) => (e.nomeAba === "Contas" ? { ...e, titulos: ["Nome", "Mail", ...e.titulos.slice(2)] } : e));
    expect(() => entregar(s.abas, cabecalhoErrado, "xlsx", s.principal)).toThrow(/cabeçalho da coluna 2/);
    const csv = montar(pedido({ f: "1", abas: "acessos" }), { acessos: dados().acessos }, "csv");
    const csvErrado = csv.esperado.map((e) => ({ ...e, nLinhas: 5 }));
    expect(() => entregar(csv.abas, csvErrado, "csv", csv.principal)).toThrow(ExportacaoInconsistenteError);
  });
});

describe("teto de linhas por aba", () => {
  it("no teto passa; um acima recusa com a aba, o número e o que fazer (datas)", () => {
    expect(() => verificarTeto({ acessos: MAX_LINHAS, mcp: 5 })).not.toThrow();
    let erro: unknown;
    try {
      verificarTeto({ acessos: MAX_LINHAS + 1 });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ExportacaoGrandeDemaisError);
    const m = (erro as Error).message;
    expect(m).toContain("Acessos (20.001 linhas)");
    expect(m).toContain("20.000");
    expect(m).toContain("datas (de/até)");
  });

  it("aba de ESTADO acima do teto: a data não ajuda, a mensagem manda desmarcar", () => {
    expect(() => verificarTeto({ contas: 11 }, 10)).toThrow(/Contas \(11 linhas, esta aba não é filtrada por data\)\. Desmarque/);
    const misto = () => verificarTeto({ contas: 11, mcp: 12 }, 10);
    expect(misto).toThrow(ExportacaoGrandeDemaisError);
    expect(misto).toThrow(/Informe datas \(de\/até\).*e desmarque as abas de estado/);
  });
});

describe("descrição, nome do arquivo e filtros do log", () => {
  it("descreverPedidoAcessos", () => {
    expect(descreverPedidoAcessos(pedido())).toEqual([
      [`Período dos eventos (fuso de Fortaleza, UTC−3)`, "todo o histórico (sem filtro de datas)"],
      ["Abas pedidas", "Contas · Acessos · Auditoria do MCP · Tokens do MCP · Exportações"],
    ]);
    expect(descreverPedidoAcessos(pedido({ de: "2026-11-01", ate: "2026-11-04" }))[0]![1]).toBe("01/11/2026 a 04/11/2026");
    expect(descreverPedidoAcessos(pedido({ de: "2026-11-01" }))[0]![1]).toBe("a partir de 01/11/2026");
    expect(descreverPedidoAcessos(pedido({ ate: "2026-11-04" }))[0]![1]).toBe("até 04/11/2026");
    expect(descreverPedidoAcessos(pedido({ f: "1", abas: ["contas", "tokens"] }))[0]![1]).toBe("não se aplica (nenhuma aba de eventos marcada)");
  });

  it("no CSV a descrição diz qual aba saiu e que as outras ficaram de fora (nada de omissão silenciosa)", () => {
    const d = descreverPedidoAcessos(pedido({ f: "1", abas: ["acessos", "mcp"] }), "csv");
    expect(d[2]).toEqual(["Formato", "CSV: sai só a aba Acessos (a primeira marcada); as outras não saem neste formato"]);
    expect(descreverPedidoAcessos(pedido({ f: "1", abas: "mcp" }), "csv")[2]).toEqual(["Formato", "CSV: aba Auditoria do MCP"]);
    expect(descreverPedidoAcessos(pedido({ f: "1", abas: ["acessos", "mcp"] }), "xlsx")).toHaveLength(2);
  });

  it("nome do arquivo: ASCII, com data, '_filtrado' só quando a data mexe em aba que está no arquivo", () => {
    const hoje = "2026-11-04";
    expect(nomeDoArquivoAcessos(pedido(), hoje)).toBe("Contas_e_acessos_2026-11-04.xlsx");
    expect(nomeDoArquivoAcessos(pedido({ de: "2026-11-01" }), hoje)).toBe("Contas_e_acessos_2026-11-04_filtrado.xlsx");
    expect(nomeDoArquivoAcessos(pedido({ f: "1", abas: ["acessos", "mcp"] }), hoje, "csv")).toBe("Contas_e_acessos_acessos_2026-11-04.csv");
    expect(nomeDoArquivoAcessos(pedido({ f: "1", abas: "mcp", de: "2026-11-01" }), hoje, "csv")).toBe("Contas_e_acessos_auditoria-mcp_2026-11-04_filtrado.csv");
    // CSV da aba Contas (estado de agora): a data não a filtrou, então não leva "_filtrado"
    expect(nomeDoArquivoAcessos(pedido({ f: "1", abas: ["contas", "acessos"], de: "2026-11-01" }), hoje, "csv")).toBe("Contas_e_acessos_contas_2026-11-04.csv");
    for (const id of IDS_ABAS_ACESSOS) expect(nomeDoArquivoAcessos(pedido({ f: "1", abas: id }), hoje, "csv")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("filtros normalizados do log: só texto e listas (JSON seguro), com as abas que de fato saíram", () => {
    const p = pedido({ f: "1", abas: ["acessos", "mcp"], de: "2026-11-01" });
    const j = filtrosJsonAcessos(p, "csv");
    expect(j).toEqual({ de: "2026-11-01", ate: null, abas: ["acessos", "mcp"], formato: "csv", abasNoArquivo: ["acessos"], fuso: APP_TZ });
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
});
