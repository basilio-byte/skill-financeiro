import { describe, expect, it } from "vitest";
import { chaveLinhaCompleta, decidirOrfas, type LinhaExistente } from "@/lib/categorization/orfas";

/**
 * Os dois primeiros testes são os dois bugs CRÍTICOS que a revisão adversarial
 * achou na primeira versão da ADR-0029. Eles vêm primeiro de propósito: se
 * alguém "simplificar" esta lógica um dia, é aqui que o estrago aparece.
 */

const linha = (over: Partial<LinhaExistente> = {}): LinhaExistente => ({
  id: "L1",
  crConexaId: 17132,
  chaveLinha: "Endereço Fiscal",
  mesCredito: "2026-07",
  revisadoManualmente: false,
  ...over,
});

const chaves = (...ls: Array<[number, string, string]>) =>
  new Set(ls.map(([cr, ch, mes]) => chaveLinhaCompleta(cr, ch, mes)));

describe("decidirOrfas — os dois bugs críticos da revisão adversarial", () => {
  it("janela que cruza dois meses NÃO apaga o mês que a rodada não emitiu", () => {
    // Sync manual 01/07–31/08 (é o que "Aplicar agora" em /categorias monta).
    // A fatura credita nos dois meses, mas a rodada só consegue emitir UMA
    // parcela — a de julho. A linha de agosto não pode morrer por isso.
    const existentes = [
      linha({ id: "L-JUL", mesCredito: "2026-07" }),
      linha({ id: "L-AGO", mesCredito: "2026-08" }),
    ];
    const decisao = decidirOrfas(
      existentes,
      chaves([17132, "Endereço Fiscal", "2026-07"]),
      new Map([[17132, new Set(["2026-07", "2026-08"])]]),
      ["2026-07", "2026-08"],
      new Map([[17132, new Set(["2026-07"])]]), // a rodada so emitiu julho
    );
    expect(decisao.idsParaApagar).toEqual([]);
  });

  it("mês que SUMIU da lista de Data Crédito é apagado, mesmo fora da janela", () => {
    // A data foi corrigida de 10/07 para 10/08 no Conexa. A linha de julho
    // precisa morrer, senão julho e agosto contam a MESMA receita para sempre.
    const decisao = decidirOrfas(
      [linha({ id: "L-JUL", mesCredito: "2026-07" })],
      chaves([17132, "Endereço Fiscal", "2026-08"]),
      new Map([[17132, new Set(["2026-08"])]]), // julho saiu da lista
      ["2026-08"], // janela do auto-sync: só agosto
      new Map([[17132, new Set(["2026-08"])]]),
    );
    expect(decisao.idsParaApagar).toEqual(["L-JUL"]);
  });
});

describe("decidirOrfas — o resto do contrato", () => {
  it("linha que a rodada acabou de gravar nunca é órfã", () => {
    const decisao = decidirOrfas(
      [linha({ id: "L1" })],
      chaves([17132, "Endereço Fiscal", "2026-07"]),
      new Map([[17132, new Set(["2026-07"])]]),
      ["2026-07"],
      new Map([[17132, new Set(["2026-07"])]]),
    );
    expect(decisao.idsParaApagar).toEqual([]);
  });

  it("bucket que mudou de categoria no MESMO mês é apagado (órfã clássica)", () => {
    // A skill passou a mapear o serviço: "Sem Categoria" virou categoria real.
    // O bucket antigo, do mesmo mês, tem de sair — senão dobra a receita.
    const decisao = decidirOrfas(
      [linha({ id: "L-VELHA", chaveLinha: "Sem Categoria", mesCredito: "2026-07" })],
      chaves([17132, "Serviços de Espaço - Seaway Center", "2026-07"]),
      new Map([[17132, new Set(["2026-07"])]]),
      ["2026-07"],
      new Map([[17132, new Set(["2026-07"])]]),
    );
    expect(decisao.idsParaApagar).toEqual(["L-VELHA"]);
  });

  it("revisada manualmente é PRESERVADA e reportada, nunca apagada", () => {
    const decisao = decidirOrfas(
      [linha({ id: "L-MANUAL", chaveLinha: "Sem Categoria", revisadoManualmente: true })],
      chaves([17132, "Outra Categoria", "2026-07"]),
      new Map([[17132, new Set(["2026-07"])]]),
      ["2026-07"],
      new Map([[17132, new Set(["2026-07"])]]),
    );
    expect(decisao.idsParaApagar).toEqual([]);
    expect(decisao.preservadasPorRevisao).toEqual(["17132::2026-07"]);
  });

  it("fatura que sumiu do resultado: apaga só o que está DENTRO da janela (ADR-0020)", () => {
    // Status mudou para algo não aceito. A fatura não veio nesta rodada, então
    // não temos a lista de datas dela. Dentro da janela podemos condenar;
    // fora dela, não sabemos nada e ficamos quietos.
    const decisao = decidirOrfas(
      [
        linha({ id: "L-JUL", mesCredito: "2026-07" }),
        linha({ id: "L-JUN", mesCredito: "2026-06" }),
      ],
      new Set(),
      new Map(), // fatura ausente desta rodada
      ["2026-07"],
      new Map(),
    );
    expect(decisao.idsParaApagar).toEqual(["L-JUL"]);
  });

  it("lista de datas vazia/ilegível não condena nada fora da janela", () => {
    // Sem a verdade do Conexa, cair no ramo da janela é o comportamento seguro.
    // O contrário — condenar tudo — apagaria meses inteiros por um campo ruim.
    const decisao = decidirOrfas(
      [linha({ id: "L-JUN", mesCredito: "2026-06" })],
      new Set(),
      new Map([[17132, new Set<string>()]]),
      ["2026-08"],
      new Map(),
    );
    expect(decisao.idsParaApagar).toEqual([]);
  });

  it("não confunde faturas diferentes que compartilham categoria e mês", () => {
    const decisao = decidirOrfas(
      [
        linha({ id: "L-A", crConexaId: 111, mesCredito: "2026-07" }),
        linha({ id: "L-B", crConexaId: 222, mesCredito: "2026-07" }),
      ],
      chaves([111, "Endereço Fiscal", "2026-07"]),
      new Map([
        [111, new Set(["2026-07"])],
        [222, new Set(["2026-08"])], // 222 nao credita mais em julho
      ]),
      ["2026-07"],
      new Map([[111, new Set(["2026-07"])]]),
    );
    expect(decisao.idsParaApagar).toEqual(["L-B"]);
  });
});
