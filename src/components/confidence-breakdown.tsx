import { formatBRL } from "@/lib/money";
import { CONFIANCA } from "@/lib/viz/palette";
import type { ConfiancaBreakdown } from "@/lib/reports/overview";

const SEGMENTS: Array<{ key: keyof ConfiancaBreakdown; label: string; color: string }> = [
  { key: "unica", label: 'Categoria única ("N")', color: CONFIANCA.unica },
  { key: "rateado", label: 'Rateado entre categorias ("S")', color: CONFIANCA.rateado },
  { key: "semLv", label: 'Sem Listar Vendas ("Sem LV")', color: CONFIANCA.semLv },
];

/**
 * Composição da receita do período pelo flag `Proporcionado` da skill
 * categoriza-receita — diferente de BreakdownList (ranking de itens abertos,
 * sempre uma matiz): aqui são 3 estados fixos com significado de confiança,
 * então cada um leva sua própria cor, como o `tone` de KpiCard.
 */
export function ConfidenceBreakdown({ data, emptyLabel = "Sem dados" }: { data: ConfiancaBreakdown; emptyLabel?: string }) {
  const total = SEGMENTS.reduce((acc, s) => acc + Math.max(0, Number(data[s.key])), 0);

  if (total <= 0) {
    return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        {SEGMENTS.map((s) => {
          const valor = Math.max(0, Number(data[s.key]));
          const pct = (valor / total) * 100;
          return pct > 0 ? <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} /> : null;
        })}
      </div>
      <ul className="flex flex-col gap-1.5">
        {SEGMENTS.map((s) => {
          const valor = Math.max(0, Number(data[s.key]));
          const pct = Math.round((valor / total) * 100);
          return (
            <li key={s.key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-slate-700">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
              <span className="tabular-nums shrink-0 text-slate-500">
                <span className="font-medium text-slate-900">{formatBRL(data[s.key])}</span> · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
