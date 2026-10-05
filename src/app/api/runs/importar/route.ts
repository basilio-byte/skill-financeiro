import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { SincronizacaoEmAndamentoError } from "@/lib/categorization/run";
import { gerarPrevia, importarExports, ImportacaoDesatualizadaError } from "@/lib/categorization/importacao";
import {
  ImportacaoInvalidaError,
  TAMANHO_MAXIMO_BYTES,
  TAMANHO_MAXIMO_ENVIO_BYTES,
  TAMANHO_MAXIMO_TEXTO,
} from "@/lib/categorization/validar-exports";

export const dynamic = "force-dynamic";

/**
 * Importação manual dos exports do Conexa (ADR-0034), em duas chamadas:
 *   acao=previa   → só lê e mostra o que mudaria (nada é gravado);
 *   acao=importar → grava, exigindo o `selo` da prévia (e `confirmacao` quando ela pede).
 *
 * Rota de API (e não server action) por causa do tamanho: o limite de corpo de uma
 * server action é 1 MB, e um export de um mês passa disso.
 */

function falha(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function arquivo(form: FormData, campo: string, rotulo: string) {
  const f = form.get(campo);
  if (!(f instanceof File) || f.size === 0) {
    throw new ImportacaoInvalidaError(`Envie o arquivo de ${rotulo}.`);
  }
  if (f.size > TAMANHO_MAXIMO_BYTES) {
    throw new ImportacaoInvalidaError(`O arquivo de ${rotulo} é grande demais (máximo ${TAMANHO_MAXIMO_TEXTO}). Um export de um mês tem centenas de KB — confira o filtro de período no Conexa.`);
  }
  return { nome: f.name.slice(0, 200), conteudo: Buffer.from(await f.arrayBuffer()) };
}

export async function POST(req: Request) {
  // ADMIN, como o disparo de sincronização: importar reescreve linhas de receita já gravadas.
  // Rota de API: 401/403 em JSON, não redirecionar para uma página HTML.
  const user = await getSessionUser();
  if (!user) return falha(401, "Não autenticado.");
  if (user.role !== "ADMIN") return falha(403, "Apenas administradores podem importar arquivos.");

  // Corpo acima do limite chega truncado ao handler (middleware do Next, 10 MB) e viraria um
  // "envio inválido" sem explicação — recusa antes, dizendo o motivo.
  if (Number(req.headers.get("content-length") ?? 0) > TAMANHO_MAXIMO_ENVIO_BYTES) {
    return falha(413, `Envio grande demais (máximo ${TAMANHO_MAXIMO_TEXTO}). Um export de um mês tem centenas de KB — confira o filtro de período no Conexa.`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return falha(400, "Envio inválido — esperado um formulário com os dois arquivos.");
  }

  try {
    const acao = form.get("acao");
    if (acao !== "previa" && acao !== "importar") return falha(400, 'Campo "acao" deve ser "previa" ou "importar".');

    const periodoInicio = new Date(`${String(form.get("periodoInicio") ?? "")}T00:00:00Z`);
    const periodoFim = new Date(`${String(form.get("periodoFim") ?? "")}T00:00:00Z`);
    const contasReceber = await arquivo(form, "contasReceber", "Contas a Receber");
    const listarVendas = await arquivo(form, "listarVendas", "Listar Vendas");

    if (acao === "previa") {
      const previa = await gerarPrevia({ contasReceber, listarVendas, periodoInicio, periodoFim });
      return NextResponse.json({ previa });
    }

    const selo = String(form.get("selo") ?? "");
    if (!selo) return falha(400, "Gere a prévia antes de importar.");
    const runId = await importarExports({
      contasReceber,
      listarVendas,
      periodoInicio,
      periodoFim,
      selo,
      confirmacao: form.get("confirmacao") === "true",
      executadoPorId: user.id,
    });
    revalidatePath("/runs");
    revalidatePath("/");
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportacaoInvalidaError) return falha(422, err.message);
    if (err instanceof ImportacaoDesatualizadaError || err instanceof SincronizacaoEmAndamentoError) {
      return falha(409, err.message);
    }
    console.error("[importar] falha inesperada:", err);
    return falha(500, "Falha inesperada ao processar a importação. Nada foi gravado se a rodada não chegou ao fim — veja /runs.");
  }
}
