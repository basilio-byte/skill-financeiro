import { cn } from "@/lib/ui";
import { um, type ParamsBrutos } from "@/lib/exportacao/parametros";

/**
 * Pequenos componentes de formulário da central de exportação (ADR-0035) — só apresentação. Tudo por GET e sem
 * JavaScript, como /revisar e /inadimplentes: o estado vive na URL (colável, favoritável).
 */

/** "2026-09" → "Setembro de 2026". UTC, como o resto do app para datas sem hora. */
export function mesPorExtenso(aaaaMm: string): string {
  const [a, m] = aaaaMm.split("-").map(Number);
  const t = new Date(Date.UTC(a!, m! - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Link da própria tela com estes parâmetros. */
export function href(pares: Array<[string, string]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of pares) sp.append(k, v);
  return `/exportar?${sp.toString()}`;
}

export function Caixa({
  nome,
  valor,
  rotulo,
  marcado,
  desabilitado,
}: {
  nome: string;
  valor: string;
  rotulo: string;
  marcado: boolean;
  desabilitado?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[13.5px] text-slate-700">
      <input type="checkbox" name={nome} value={valor} defaultChecked={marcado} disabled={desabilitado} className="h-4 w-4 rounded border-slate-300" />
      <span>{rotulo}</span>
    </label>
  );
}

export function Grupo({ legenda, dica, children }: { legenda: string; dica?: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="label">{legenda}</legend>
      {dica ? <p className="mb-1.5 text-xs text-slate-500">{dica}</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </fieldset>
  );
}

/** Opção de coluna/aba com descrição (caixa + título + explicação). */
export function OpcaoComDescricao({
  id,
  nome,
  valor,
  rotulo,
  descricao,
  marcado,
  desabilitado,
  nota,
}: {
  id: string;
  nome: string;
  valor: string;
  rotulo: string;
  descricao: string;
  marcado: boolean;
  desabilitado?: boolean;
  /** Texto curto ao lado do rótulo: "(sempre)", "— somente administrador". */
  nota?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" name={nome} value={valor} defaultChecked={marcado} disabled={desabilitado} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
      <label htmlFor={id} className="text-[13.5px] text-slate-700">
        <span className="font-medium">{rotulo}</span>
        {nota ? <span className="text-slate-400"> {nota}</span> : null}
        <span className={cn("block text-xs text-slate-500")}>{descricao}</span>
      </label>
    </div>
  );
}

/** Atalhos (links que preenchem o formulário). */
export function Atalhos({ itens }: { itens: Array<{ rotulo: string; dica: string; url: string }> }) {
  return (
    <div className="mb-5">
      <p className="label">Atalhos</p>
      <div className="flex flex-wrap gap-2">
        {itens.map((a) => (
          <a key={a.rotulo} href={a.url} title={a.dica} className="btn-secondary px-3 py-1.5 text-[13px]">
            {a.rotulo}
          </a>
        ))}
      </div>
    </div>
  );
}

/** O bloco "Corrija antes de baixar" — mesma aparência em todas as telas. */
export function ErrosDoPedido({ erros }: { erros: string[] }) {
  if (erros.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">Corrija antes de baixar:</p>
      <ul className="mt-1 list-disc pl-5">
        {erros.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Rodapé de download — o MESMO em todas as telas. O botão é um submit do formulário `idForm` (atributo `form`) com
 * `formAction` na rota de download; o seletor de formato também pertence ao formulário. O que vale é o que está nos
 * campos agora; a aba Leia-me (a última) do .xlsx lista os filtros que valeram.
 */
export function RodapeDeDownload({
  idForm,
  rota,
  formatos,
  nota,
  formatoAtual = "xlsx",
}: {
  idForm: string;
  /** Id do conjunto na rota /api/exportar/<rota>. */
  rota: string;
  formatos: Array<"xlsx" | "csv">;
  nota?: string;
  /** O formato que a pessoa já tinha escolhido (volta na URL ao "Atualizar prévia" ou depois de um erro). */
  formatoAtual?: "xlsx" | "csv";
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {formatos.length > 1 ? (
        <div className="flex items-center gap-2">
          <label className="text-[13px] text-slate-600" htmlFor={`${idForm}-formato`}>
            Formato
          </label>
          <select id={`${idForm}-formato`} name="formato" form={idForm} defaultValue={formatoAtual} className="input w-auto">
            <option value="xlsx">Planilha (.xlsx)</option>
            <option value="csv">CSV (só o detalhe)</option>
          </select>
        </div>
      ) : null}
      <button type="submit" form={idForm} formAction={`/api/exportar/${rota}`} className="btn">
        Baixar arquivo
      </button>
      <span className="text-xs text-slate-500">
        {nota ?? "O .xlsx abre direto nos dados; a última aba (Leia-me) traz os filtros, a hora e a atualidade, e só é entregue depois de conferido."}
        {formatos.includes("csv") ? " O CSV traz só o detalhe, sem Leia-me nem resumos, e o Excel pode converter chaves de mês (2026-10) em data: para conservá-las, use o .xlsx." : ""}
        {" A prévia mostra o recorte da última vez que você clicou em Atualizar prévia; o download usa os campos como estão agora."}
      </span>
    </div>
  );
}

/** O formato que veio na URL (só "csv" é diferente do padrão). */
export function formatoDe(params: ParamsBrutos): "xlsx" | "csv" {
  return um(params.formato) === "csv" ? "csv" : "xlsx";
}
