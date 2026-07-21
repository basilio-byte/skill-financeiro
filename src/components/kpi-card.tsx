import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/ui";

interface KpiCardProps {
  label: string;
  /** Valor monetário ("1234.56") — formatado como BRL. Use isto OU `value`. */
  amount?: string;
  /** Valor já formatado para exibição (ex.: contagens) — use isto OU `amount`. */
  value?: string;
  hint?: string;
  tone?: "neutral" | "positive" | "negative";
  sublabel?: string;
}

export function KpiCard({ label, amount, value, hint, tone = "neutral", sublabel }: KpiCardProps) {
  const color =
    tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-slate-900";
  const display = amount !== undefined ? formatBRL(amount) : (value ?? "—");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", color)}>{display}</p>
      {sublabel ? <p className="mt-1 text-xs text-slate-500">{sublabel}</p> : null}
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
