import { Card, SectionTitle } from "@/components/ui";
import { formatBRL } from "@/lib/money";

export interface TableColumn {
  key: string;
  label: string;
  /** Formata como moeda (BRL) e alinha à direita. */
  money?: boolean;
}

/**
 * Card de gráfico com a TABELA GÊMEA embutida.
 * Regra de acessibilidade: nenhum valor existe só no tooltip — todo gráfico tem
 * um equivalente em tabela, alcançável por teclado (<details>/<summary>).
 */
export function ChartCard({
  title,
  hint,
  children,
  rows,
  columns,
  footer,
}: {
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
  rows: Array<Record<string, string | number>>;
  columns: TableColumn[];
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      {children}
      {footer}
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 outline-none transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-seahub-300">
          <span className="inline-block transition group-open:rotate-90">›</span> Ver dados em tabela
        </summary>
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-xs uppercase text-slate-400">
                {columns.map((c) => (
                  <th key={c.key} className={`px-3 py-2 ${c.money ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.money ? "tabular text-right text-slate-800" : "text-slate-600"}`}>
                      {c.money ? formatBRL(Number(row[c.key] ?? 0)) : String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
