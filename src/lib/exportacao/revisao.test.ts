import { describe, expect, it } from "vitest";
import { HX, T, type Sheet } from "@/lib/xlsx/writer";
import { assinarMensagem, mensagemVerificada } from "./assinatura";
import { entregar, exigirTextoValido } from "./empacotar";
import { ceder, emExclusao, PRAZO_MS } from "./fila";
import { descreverFiltros, filtrosParaWhere, lerFiltrosReceita, temFiltroAlemDoPeriodo } from "./filtros-receita";
import { escaparLike, exigirTextoLimpo, um, validarParametros } from "./parametros";
import { abaDeTabela, abaLeiaMe, quebrarEmLinhas } from "./planilha";
import { contagem, plural } from "./plural";
import { temCaractereInvalido, textoSeguro } from "./texto";
import { ExportacaoCanceladaError, ExportacaoGrandeDemaisError, ExportacaoInconsistenteError } from "./tipos";
import { lerPedidoRegras } from "./pasta-regras";
import { lerPedidoInadimplencia } from "./pasta-inadimplencia";
import { lerPedidoSincronizacoes } from "./pasta-sincronizacoes";
import { lerPedidoClickUp } from "./pasta-clickup";
import { lerPedidoAcessos } from "./pasta-acessos";
import { lerPedidoConflitos } from "./pasta-conflitos";
import { lerPedidoMetas } from "./pasta-metas";

/**
 * Correções da revisão adversarial da central de exportação (ADR-0035): cada teste trava um defeito achado — fila que
 * não cancela, caractere de controle que vira XML inválido ou derruba a consulta, curinga do LIKE, mensagem de erro
 * forjada, nota espremida, linhas de valor zero.
 */

const dorme = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("fila: cancelamento e prazo", () => {
  it("sinal já abortado: nem entra na fila", async () => {
    const c = new AbortController();
    c.abort();
    let rodou = false;
    await expect(emExclusao(async () => ((rodou = true), 1), { sinal: c.signal })).rejects.toBeInstanceOf(ExportacaoCanceladaError);
    expect(rodou).toBe(false);
  });

  it("quem desconectou ENQUANTO esperava a vez não roda (e não atrasa a seguinte)", async () => {
    const c = new AbortController();
    const lenta = emExclusao(async () => (await dorme(30), "a"));
    let rodou = false;
    const esperando = emExclusao(async () => ((rodou = true), "b"), { sinal: c.signal });
    const seguinte = emExclusao(async () => "c");
    c.abort();
    await expect(esperando).rejects.toBeInstanceOf(ExportacaoCanceladaError);
    expect(await lenta).toBe("a");
    expect(await seguinte).toBe("c");
    expect(rodou).toBe(false);
  });

  it("ceder() para uma exportação cujo navegador desconectou no meio", async () => {
    const c = new AbortController();
    const r = emExclusao(
      async () => {
        await ceder();
        c.abort();
        await ceder();
        return "não devia chegar aqui";
      },
      { sinal: c.signal },
    );
    await expect(r).rejects.toBeInstanceOf(ExportacaoCanceladaError);
  });

  it("ceder() para depois do prazo, com mensagem que diz o que fazer; o prazo conta do INÍCIO da execução", async () => {
    const lenta = emExclusao(async () => dorme(40));
    // esta espera ~40 ms na fila e tem prazo de 25 ms: só pode estourar pelo tempo de EXECUÇÃO, não pelo da fila
    const ok = emExclusao(async () => (await dorme(5), await ceder(), "ok"), { prazoMs: 25 });
    expect(await ok).toBe("ok");
    await lenta;
    const estoura = emExclusao(async () => (await dorme(30), await ceder(), "não"), { prazoMs: 10 });
    await expect(estoura).rejects.toBeInstanceOf(ExportacaoGrandeDemaisError);
    await expect(estoura).rejects.toThrow(/Reduza o recorte/);
  });

  it("fora de uma exportação, ceder() só devolve o controle; o prazo padrão é de 2 minutos", async () => {
    await expect(ceder()).resolves.toBeUndefined();
    expect(PRAZO_MS).toBe(120_000);
  });
});

describe("mensagem de erro assinada", () => {
  const seg = "segredo-de-teste-com-mais-de-16-caracteres";
  it("a assinatura confere só para a mesma mensagem e o mesmo segredo", () => {
    const m = 'Mês inválido ("2026-13"): use o formato aaaa-mm.';
    const s = assinarMensagem(seg, m);
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(mensagemVerificada(seg, m, s)).toBe(m);
    expect(mensagemVerificada(seg, m + " ", s)).toBe(""); // texto alterado
    expect(mensagemVerificada("outro-segredo-outro-segredo", m, s)).toBe(""); // segredo diferente
  });

  it("link forjado (sem assinatura, curta, longa ou inventada) NÃO mostra nada", () => {
    const m = "Sua sessão expirou: confirme a senha em suporte.exemplo";
    for (const falsa of ["", "x", "0".repeat(32), "a".repeat(64), assinarMensagem(seg, "outra mensagem")]) {
      expect(mensagemVerificada(seg, m, falsa)).toBe("");
    }
    expect(mensagemVerificada(seg, "", assinarMensagem(seg, ""))).toBe("");
  });
});

describe("parâmetros: texto limpo, primeiro valor não vazio, curingas do LIKE", () => {
  it("um() pula valores vazios (mes=&mes=2026-10 não vira 'sem filtro de mês')", () => {
    expect(um(["", "2026-10"])).toBe("2026-10");
    expect(um(["  ", " x "])).toBe("x");
    expect(um([""])).toBe("");
    expect(um(undefined)).toBe("");
    expect(lerFiltrosReceita({ mes: ["", "2026-10"] }).filtros.mes).toBe("2026-10");
    expect(lerFiltrosReceita({ fatura: ["", "29113"] }).filtros.fatura).toBe(29113);
  });

  it("caractere de controle (NUL, U+0001, U+0008, U+000B, DEL, substituto solto) em QUALQUER parâmetro é erro — e o valor não é repetido na mensagem", () => {
    for (const sujo of ["ab\u0000cd", "ab\u0001cd", "ab\u0008cd", "ab\u000Bcd", "ab\u007Fcd", "ab\uD800cd", "ab￾cd"]) {
      const erros: string[] = [];
      exigirTextoLimpo({ cliente: sujo, mes: "2026-10" }, erros);
      expect(erros, JSON.stringify(sujo)).toHaveLength(1);
      expect(erros[0]).toMatch(/O parâmetro "cliente" tem caracteres de controle/);
      expect(erros[0]).not.toContain("ab");
    }
    const limpos: string[] = [];
    exigirTextoLimpo({ cliente: "Ação\tcom\ttab\ne quebra\r\n", nome: ["a", "b"], vazio: undefined }, limpos);
    expect(limpos).toEqual([]);
  });

  it("o nome do parâmetro sujo também não vaza controle na mensagem", () => {
    const erros: string[] = [];
    exigirTextoLimpo({ ["x\u0000y"]: "a\u0001" }, erros);
    expect(erros[0]).toContain('"xy"');
  });

  it("TODO conjunto recusa caractere de controle (NUL derrubava a consulta no Postgres com 500)", () => {
    const sujo = { cliente: "ab\u0000", q: "\u0000", busca: "ab\u0000cd", categoria: ["x\u0001"], origem: "\u0002", abas: "\u0003", classificacao: "\u0004", ano: "2026\u0000", servico: "a\u0000b" };
    const todos = [
      lerFiltrosReceita(sujo).erros,
      lerPedidoInadimplencia(sujo).erros,
      lerPedidoRegras(sujo).erros,
      lerPedidoMetas(sujo, 2026).erros,
      lerPedidoConflitos(sujo).erros,
      lerPedidoClickUp(sujo, "2026-11-04").erros,
      lerPedidoAcessos(sujo).erros,
      lerPedidoSincronizacoes(sujo).erros,
    ];
    todos.forEach((erros, i) => expect(erros.some((e) => /caracteres de controle/.test(e)), `conjunto #${i}: ${erros.join(" | ")}`).toBe(true));
  });

  it("validarParametros junta as duas validações", () => {
    const erros: string[] = [];
    validarParametros({ mes: ["2026-09", "2026-10"], q: "a\u0000" }, ["mes"], erros);
    expect(erros).toHaveLength(2);
  });

  it("escaparLike: % e _ viram literais e a barra também", () => {
    expect(escaparLike("__")).toBe("\\_\\_");
    expect(escaparLike("100%")).toBe("100\\%");
    expect(escaparLike("a\\b")).toBe("a\\\\b");
    expect(escaparLike("Sala 08 - Loja 14")).toBe("Sala 08 - Loja 14");
  });
});

describe("filtros de receita: busca literal e linhas de valor zero", () => {
  it("cliente e serviço entram no banco com os curingas ESCAPADOS", () => {
    const { filtros } = lerFiltrosReceita({ cliente: "a_b%c", servico: "x\\y_" });
    const where = JSON.stringify(filtrosParaWhere(filtros));
    expect(where).toContain(JSON.stringify({ razaoSocial: { contains: "a\\_b\\%c", mode: "insensitive" } }).slice(1, -1));
    expect(where).toContain(JSON.stringify({ servicoOuPlano: { contains: "x\\\\y\\_", mode: "insensitive" } }).slice(1, -1));
  });

  it("o Leia-me diz que a busca é por texto exato", () => {
    const d = descreverFiltros(lerFiltrosReceita({ cliente: "Ana", servico: "Sala" }).filtros).map(([k]) => k);
    expect(d).toContain("Cliente contém (texto exato)");
    expect(d).toContain("Serviço/plano contém (texto exato)");
  });

  it("semZeradas: padrão desligado, 0/1 explícito, entra no where e no Leia-me, e conta como filtro além do período", () => {
    expect(lerFiltrosReceita({}).filtros.semZeradas).toBe(false);
    expect(lerFiltrosReceita({ f: "1" }).filtros.semZeradas).toBe(false);
    const { filtros } = lerFiltrosReceita({ semZeradas: "1" });
    expect(filtros.semZeradas).toBe(true);
    expect(JSON.stringify(filtrosParaWhere(filtros))).toContain('"valorRecebidoCat":{"not":0}');
    expect(JSON.stringify(filtrosParaWhere(lerFiltrosReceita({}).filtros))).toBe("{}");
    expect(descreverFiltros(filtros)).toContainEqual(["Linhas de valor R$ 0,00", "ignoradas (como a fila do Revisar)"]);
    expect(temFiltroAlemDoPeriodo(filtros)).toBe(true);
    expect(temFiltroAlemDoPeriodo(lerFiltrosReceita({}).filtros)).toBe(false);
    expect(lerFiltrosReceita({ semZeradas: "talvez" }).erros[0]).toMatch(/Ignorar linhas de valor zero: valor desconhecido/);
  });
});

describe("planilha: texto limpo, rótulos que quebram e notas legíveis", () => {
  const sujo = "x\u0000\u0001\u0008\u000B\u000C\u001F￾\uD800y";

  it("o Leia-me limpa TUDO que escreve (título, quem gerou, filtros digitados, resultado, atualidade, avisos, conferência)", () => {
    const aba = abaLeiaMe({
      titulo: `T${sujo}`,
      geradoEm: new Date("2026-11-04T20:00:00Z"),
      geradoPor: `Ana${sujo} (a@x)`,
      filtros: [[`Cliente${sujo}`, `ab${sujo}cd`]],
      resultado: [[`R${sujo}`, `1${sujo}`]],
      frescor: { texto: `ok${sujo}`, alerta: false },
      avisos: [`a${sujo}`],
      conferencia: `c${sujo}`,
    });
    const textos = aba.rows.flat().map((c) => c.text ?? "");
    expect(textos.some(temCaractereInvalido)).toBe(false);
    expect(textos.join("|")).toContain("abxy".slice(0, 2) + "xycd");
    expect(() => exigirTextoValido([aba])).not.toThrow();
  });

  it("rótulo do Leia-me é negrito COM quebra (estilo 13) e a coluna A é mais larga", () => {
    const aba = abaLeiaMe({ titulo: "T", geradoEm: new Date(), geradoPor: "x", filtros: [["Um rótulo bem comprido que antes era cortado pelo valor ao lado", "v"]], resultado: [], frescor: { texto: "ok", alerta: false }, avisos: [], conferencia: "ok" });
    const linha = aba.rows.find((r) => r[0]?.text?.startsWith("Um rótulo"))!;
    expect(linha[0]!.style).toBe(13);
    expect(linha[1]!.style).toBe(7);
    expect(aba.colWidths![0]).toBeGreaterThanOrEqual(44);
  });

  it("quebrarEmLinhas: só entre palavras, respeita o máximo e corta palavra gigante", () => {
    const l = quebrarEmLinhas("um dois três quatro cinco seis sete oito nove dez", 20);
    expect(l.every((x) => x.length <= 20)).toBe(true);
    expect(l.join(" ")).toBe("um dois três quatro cinco seis sete oito nove dez");
    expect(quebrarEmLinhas("a".repeat(25), 10)).toEqual(["a".repeat(10), "a".repeat(10), "a".repeat(5)]);
    expect(quebrarEmLinhas("linha 1\nlinha 2", 50)).toEqual(["linha 1", "linha 2"]);
    expect(quebrarEmLinhas("", 50)).toEqual([""]);
  });

  it("a nota de uma aba vira linhas curtas SEM quebra automática (transborda para a direita), depois de uma linha em branco", () => {
    const nota = "NÃO some as linhas desta aba: o escopo todas as categorias contém a receita dos demais escopos e mensal e trimestral são séries independentes. ".repeat(3);
    const aba = abaDeTabela({
      nome: "Dados",
      colunas: [{ titulo: "Tipo", tipo: "texto", largura: 12 }, { titulo: "Valor", tipo: "dinheiro", largura: 14 }],
      linhas: [["a", "1.00"]],
      nota,
    });
    const depois = aba.rows.slice(2); // cabeçalho + 1 linha de dados + [] + notas
    expect(depois[0]).toEqual([]);
    const linhasDaNota = depois.slice(1);
    expect(linhasDaNota.length).toBeGreaterThan(2);
    for (const r of linhasDaNota) {
      expect(r).toHaveLength(1);
      expect(r[0]!.style).toBe(0); // sem quebra automática
      expect(r[0]!.text!.length).toBeLessThanOrEqual(110);
    }
    expect(linhasDaNota.map((r) => r[0]!.text).join(" ")).toBe(nota.trim().replace(/\s+/g, " "));
    expect(aba.autoFiltro).toEqual({ primeiraLinha: 1, ultimaLinha: 2, ultimaColuna: 1 }); // a nota fica fora do filtro
  });

  it("texto da nota e rótulo de total também passam por textoSeguro", () => {
    const aba = abaDeTabela({ nome: "D", colunas: [{ titulo: "A", tipo: "texto", largura: 10 }], linhas: [], total: [`TOTAL${sujo}`], nota: `n${sujo}` });
    expect(aba.rows.flat().some((c) => c.text && temCaractereInvalido(c.text))).toBe(false);
  });
});

describe("guarda de texto válido antes de entregar", () => {
  const aba = (texto: string): Sheet => ({ name: "Dados", rows: [[HX("a")], [T(texto)]] });
  const esperado = [{ nomeAba: "Dados", titulos: ["a"], nLinhas: 1, indiceValor: -1, total: null }];

  it("acusa a aba e a linha do texto inválido (defeito do gerador), em xlsx e em CSV, e NÃO entrega", () => {
    expect(() => exigirTextoValido([aba("ok"), aba("x\u0001")])).toThrow(/aba "Dados", linha 2/);
    expect(() => entregar([aba("x\u0008")], esperado, "xlsx", "Dados")).toThrow(ExportacaoInconsistenteError);
    expect(() => entregar([aba("x\uD800")], esperado, "csv", "Dados")).toThrow(ExportacaoInconsistenteError);
  });

  it("texto limpo passa (e textoSeguro tira o que a guarda acusaria)", () => {
    expect(() => entregar([aba("Ação normal")], esperado, "xlsx", "Dados")).not.toThrow();
    expect(() => entregar([aba(textoSeguro("x\u0001\u0008"))], esperado, "csv", "Dados")).not.toThrow();
  });
});

describe("concordância", () => {
  it("plural e contagem em português (o zero é plural)", () => {
    expect(plural(1, "dia", "dias")).toBe("dia");
    expect(plural(0, "dia", "dias")).toBe("dias");
    expect(plural(2, "dia", "dias")).toBe("dias");
    expect(contagem(1, "ativo", "ativos")).toBe("1 ativo");
    expect(contagem(1234, "dia", "dias")).toBe("1.234 dias");
    expect(contagem(0, "inativo", "inativos")).toBe("0 inativos");
  });
});
