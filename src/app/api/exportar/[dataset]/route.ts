import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { assinarMensagem } from "@/lib/exportacao/assinatura";
import { ConjuntoDesconhecidoError, executarExportacao } from "@/lib/exportacao/executar";
import { registrarExportacao } from "@/lib/exportacao/log";
import { paramsDe, paraQueryString } from "@/lib/exportacao/params";
import {
  ExportacaoCanceladaError,
  ExportacaoGrandeDemaisError,
  ExportacaoInconsistenteError,
  ExportacaoInvalidaError,
  ExportacaoNegadaError,
  ExportacaoOcupadaError,
  type Formato,
  type UsuarioExport,
} from "@/lib/exportacao/tipos";

/**
 * Download de uma exportação (ADR-0035): `GET /api/exportar/<conjunto>?<filtros>`.
 *
 * Só LEITURA. Exige sessão (a mesma das telas; o middleware já barra quem não tem cookie) e confere o papel DENTRO do
 * gerador — conjunto ou grupo de colunas só de administrador é recusado com 403 mesmo que o link seja montado à mão.
 *
 * Erros: quem chega por navegador (formulário da tela /exportar) volta para a tela com a mensagem (ASSINADA: link forjado
 * não vira alerta) e os filtros preservados; quem chama por outro cliente recebe JSON com o status certo (400 pedido
 * inválido, 403 sem permissão, 404 conjunto desconhecido, 422 recorte grande demais ou fora do prazo, 499 o navegador
 * desconectou, 500 conferência interna que não fechou, 503 fila cheia).
 *
 * Só GET gera arquivo: HEAD (sondagem de link, pré-busca de navegador) responde 405 em vez de rodar a exportação inteira.
 */
export const dynamic = "force-dynamic";

interface Falha {
  status: number;
  mensagem: string;
  /** Vai para o log de exportações? (pedido digitado errado não vai.) */
  registrar?: "erro" | "recusada" | "cancelada";
}

function classificar(e: unknown): Falha {
  if (e instanceof ConjuntoDesconhecidoError) return { status: 404, mensagem: e.message };
  if (e instanceof ExportacaoInvalidaError) return { status: 400, mensagem: e.erros.join(" ") };
  if (e instanceof ExportacaoNegadaError) return { status: 403, mensagem: e.message, registrar: "recusada" };
  if (e instanceof ExportacaoGrandeDemaisError) return { status: 422, mensagem: e.message, registrar: "erro" };
  if (e instanceof ExportacaoOcupadaError) return { status: 503, mensagem: e.message };
  if (e instanceof ExportacaoCanceladaError) return { status: 499, mensagem: e.message, registrar: "cancelada" };
  if (e instanceof ExportacaoInconsistenteError) {
    return { status: 500, mensagem: `${e.message} Tente de novo; se persistir, avise quem mantém o painel.`, registrar: "erro" };
  }
  console.error("[exportar] falha inesperada:", e);
  return { status: 500, mensagem: "Não foi possível gerar a exportação (erro interno). Tente de novo; se persistir, avise quem mantém o painel.", registrar: "erro" };
}

export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
}

export async function GET(req: Request, ctx: { params: Promise<{ dataset: string }> }) {
  const user = await requireUser();
  const { dataset } = await ctx.params;
  const url = new URL(req.url);
  const params = paramsDe(url.searchParams);
  const usuario: UsuarioExport = { id: user.id, nome: user.name, email: user.email, papel: user.role };
  const formatoBruto = (url.searchParams.get("formato") ?? "").trim();
  const formato: Formato = formatoBruto === "csv" ? "csv" : "xlsx";
  const inicio = Date.now();

  let falha: Falha;
  try {
    // Formato desconhecido é erro explícito (nunca cai em xlsx em silêncio).
    if (formatoBruto !== "" && formatoBruto !== "xlsx" && formatoBruto !== "csv") {
      throw new ExportacaoInvalidaError([`Formato desconhecido ("${formatoBruto.slice(0, 20)}"): use xlsx ou csv.`]);
    }
    const r = await executarExportacao(dataset, params, usuario, formato, req.signal);
    // O navegador foi embora enquanto o arquivo era feito: ninguém vai recebê-lo — não conta como entregue.
    if (req.signal.aborted) throw new ExportacaoCanceladaError();
    await registrarExportacao({
      usuario,
      conjunto: dataset,
      formato,
      filtros: r.filtrosJson,
      resumoFiltros: r.filtros.map(([k, v]) => `${k}: ${v}`).join(" | "),
      linhas: r.linhas,
      total: r.total,
      dadosPessoais: r.dadosPessoais,
      resultado: "ok",
      duracaoMs: Date.now() - inicio,
    });
    return new NextResponse(new Uint8Array(r.buffer), {
      headers: {
        "content-type": r.contentType,
        "content-disposition": `attachment; filename="${r.nomeArquivo}"; filename*=UTF-8''${encodeURIComponent(r.nomeArquivo)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    falha = classificar(e);
  }

  if (falha.registrar) {
    await registrarExportacao({ usuario, conjunto: dataset.slice(0, 40), formato, resultado: falha.registrar, erro: falha.mensagem, duracaoMs: Date.now() - inicio });
  }

  // Navegador (formulário da tela): volta para a tela, com a mensagem ASSINADA e os filtros preservados.
  // `redirect()` lança — por isso fica FORA do try/catch acima.
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const mensagem = falha.mensagem.slice(0, 600);
    const qs = paraQueryString(
      params,
      { dataset: falha.status === 404 ? "receita" : dataset, erro: mensagem, sig: assinarMensagem(getEnv().SESSION_SECRET, mensagem) },
      ["dataset", "erro", "sig"],
    );
    redirect(`/exportar?${qs}`);
  }
  return NextResponse.json({ error: falha.mensagem }, { status: falha.status, headers: { "cache-control": "no-store" } });
}
