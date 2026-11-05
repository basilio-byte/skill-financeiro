import "server-only";
import { todayKey } from "@/lib/dates";
import { acharConjunto } from "./conjuntos";
import { gerarExportacaoAcessos } from "./acessos";
import { gerarExportacaoClickUp } from "./clickup";
import { gerarExportacaoConflitos } from "./conflitos";
import { emExclusao } from "./fila";
import { lerFiltrosReceita, type ParamsBrutos } from "./filtros-receita";
import { gerarExportacaoInadimplencia, validarPermissoesInadimplencia } from "./inadimplencia";
import { abaDeItens } from "./itens";
import { gerarExportacaoMetas } from "./metas";
import { lerPedidoAcessos } from "./pasta-acessos";
import { lerPedidoClickUp } from "./pasta-clickup";
import { lerPedidoConflitos } from "./pasta-conflitos";
import { lerPedidoMetas } from "./pasta-metas";
import { lerPedidoInadimplencia } from "./pasta-inadimplencia";
import { lerPedidoRegras } from "./pasta-regras";
import { lerPedidoSincronizacoes, validarPermissoesSincronizacoes } from "./pasta-sincronizacoes";
import { gerarExportacaoReceita, validarPermissoesReceita } from "./receita";
import { gerarExportacaoRegras } from "./regras";
import { gerarExportacaoSincronizacoes } from "./sincronizacoes";
import { ExportacaoInvalidaError, ExportacaoNegadaError, type Formato, type ResultadoExportacao, type UsuarioExport } from "./tipos";

/**
 * O despachante da central de exportação (ADR-0035): dado o conjunto, os parâmetros da URL e quem pede, valida
 * permissão e parâmetros e chama o gerador certo. A rota HTTP é só uma casca em volta desta função.
 *
 * Todo gerador recebe o `formato` e entrega pelo `entregar()` (empacotar.ts), que CONFERE o arquivo lendo de volta.
 */

/** Campos que a aba Itens lê, além dos das colunas escolhidas. */
const CAMPOS_DA_ABA_ITENS = ["itensDetalhe", "ajusteArredondamento", "razaoSocial", "servicoOuPlano", "categoria", "mesCredito", "dataCredito", "crConexaId", "valorRecebidoCat", "revisadoManualmente", "proporcionado"];

export class ConjuntoDesconhecidoError extends Error {
  constructor(id: string) {
    super(`Conjunto de dados desconhecido: "${id.slice(0, 40)}".`);
    this.name = "ConjuntoDesconhecidoError";
  }
}

export async function executarExportacao(
  conjuntoId: string,
  params: ParamsBrutos,
  usuario: UsuarioExport,
  formato: Formato = "xlsx",
  /** Sinal de cancelamento da requisição: o navegador desconectou. */
  sinal?: AbortSignal,
): Promise<ResultadoExportacao> {
  const conjunto = acharConjunto(conjuntoId);
  if (!conjunto) throw new ConjuntoDesconhecidoError(conjuntoId);
  if (conjunto.somenteAdmin && usuario.papel !== "ADMIN") {
    throw new ExportacaoNegadaError(`O conjunto "${conjunto.titulo}" só pode ser exportado por administradores.`);
  }
  if (!conjunto.formatos.includes(formato)) {
    throw new ExportacaoInvalidaError([`O conjunto "${conjunto.titulo}" não está disponível em ${formato.toUpperCase()}.`]);
  }

  // Valida pedido E permissão ANTES de entrar na fila (pedido inválido ou negado não ocupa o lugar de ninguém e não
  // espera a vez de uma exportação pesada para ouvir "não"); gera DENTRO dela (uma por vez). Cada gerador confere a
  // permissão de novo (defesa em profundidade).
  const naFila = <T,>(fn: () => Promise<T>) => emExclusao(fn, { sinal });
  switch (conjunto.id) {
    case "receita": {
      const { filtros, erros } = lerFiltrosReceita(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      validarPermissoesReceita(filtros, usuario);
      return naFila(() =>
        gerarExportacaoReceita(
          filtros,
          usuario,
          filtros.itens && formato === "xlsx"
            ? {
                formato,
                camposExtras: CAMPOS_DA_ABA_ITENS,
                extras: (linhas) => {
                  const r = abaDeItens(linhas);
                  return [{ aba: r.aba, soma: r.soma, aviso: r.aviso }];
                },
              }
            : { formato },
        ),
      );
    }
    case "inadimplencia": {
      const { pedido, erros } = lerPedidoInadimplencia(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      validarPermissoesInadimplencia(pedido, usuario);
      return naFila(() => gerarExportacaoInadimplencia(pedido, usuario, formato));
    }
    case "metas": {
      const { pedido, erros } = lerPedidoMetas(params, Number(todayKey().slice(0, 4)));
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      return naFila(() => gerarExportacaoMetas(pedido, usuario, formato));
    }
    case "regras": {
      const { pedido, erros } = lerPedidoRegras(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      return naFila(() => gerarExportacaoRegras(pedido, usuario, formato));
    }
    // --- F3: cada gerador repete a checagem de papel (defesa em profundidade); conflitos, ClickUp e acessos já foram
    // recusados acima por `somenteAdmin`, e o grupo "tecnico" das sincronizações é conferido pelo gerador (403). ---
    case "conflitos": {
      const { pedido, erros } = lerPedidoConflitos(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      return naFila(() => gerarExportacaoConflitos(pedido, usuario, formato));
    }
    case "sincronizacoes": {
      const { pedido, erros } = lerPedidoSincronizacoes(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      validarPermissoesSincronizacoes(pedido, usuario);
      return naFila(() => gerarExportacaoSincronizacoes(pedido, usuario, formato));
    }
    case "clickup": {
      const { pedido, erros } = lerPedidoClickUp(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      return naFila(() => gerarExportacaoClickUp(pedido, usuario, formato));
    }
    case "acessos": {
      const { pedido, erros } = lerPedidoAcessos(params);
      if (erros.length) throw new ExportacaoInvalidaError(erros);
      return naFila(() => gerarExportacaoAcessos(pedido, usuario, formato));
    }
    default:
      throw new ConjuntoDesconhecidoError(conjuntoId);
  }
}
