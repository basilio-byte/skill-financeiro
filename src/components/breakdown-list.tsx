import { formatBRL } from "@/lib/money";
import { MAGNITUDE } from "@/lib/viz/palette";

export interface BreakdownItem {
  key: string;
  label: string;
  /** valor monetário como string exata ("1234.56"). */
  total: string;
}

/**
 * Ranking por valor = MAGNITUDE → uma única matiz para todas as barras.
 * Colorir cada barra de um tom diferente duplicaria a informação que o
 * comprimento já carrega — e um serviço novo viraria "mais uma cor" sem fim.
 * Rótulo e valor sempre visíveis — a cor não carrega significado aqui.
 */
export function BreakdownList({ items, emptyLabel = "Sem dados" }: { items: BreakdownItem[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...items.map((i) => Math.abs(Number(i.total))));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const pct = Math.round((Math.abs(Number(item.total)) / max) * 100);
        return (
          <li key={item.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-slate-700" title={item.label}>
                {item.label}
              </span>
              <span className="tabular shrink-0 font-medium text-slate-900">{formatBRL(item.total)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: MAGNITUDE }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
