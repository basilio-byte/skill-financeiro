import { Dica } from "@/components/dica";

/**
 * Cabeçalho de página — o MESMO em todas as telas.
 *
 * Título + uma linha de subtítulo (no máximo) + dica opcional para o detalhe. `acao` é o que fica à direita
 * (controles de período, botões). Só apresentação: nenhum dado nem comportamento passa por aqui.
 */
export function PageHeader({
  titulo,
  descricao,
  dica,
  acao,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** O detalhe que não cabe numa linha, mas existe por rigor. */
  dica?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] text-slate-900">{titulo}</h1>
        {descricao || dica ? (
          <p className="mt-1 flex items-center gap-1.5 text-[14px] text-slate-500">
            {descricao}
            {dica ? <Dica>{dica}</Dica> : null}
          </p>
        ) : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </div>
  );
}
