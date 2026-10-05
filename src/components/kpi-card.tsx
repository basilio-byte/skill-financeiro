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

/**
 * Faixa de indicadores: UM cartão com as células separadas por linhas finas, em vez de quatro cartões
 * idênticos lado a lado (o "template de métricas" que todo painel genérico tem). As linhas finas vêm do
 * `gap-px` sobre um fundo de borda, o que funciona para qualquer número de colunas e de quebras de linha.
 */
export function KpiStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 shadow-1 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Uma célula da faixa. A cor do número só aparece quando CARREGA significado (positivo / atenção). */
export function KpiCard({ label, amount, value, hint, tone = "neutral", sublabel }: KpiCardProps) {
  const color =
    tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-600" : "text-slate-900";
  const display = amount !== undefined ? formatBRL(amount) : (value ?? "—");
  return (
    <div className="bg-card px-5 py-4">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className={cn("tabular mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em]", color)}>{display}</p>
      {sublabel || hint ? (
        <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
          {sublabel}
          {sublabel && hint ? " · " : ""}
          {hint}
        </p>
      ) : null}
    </div>
  );
}
