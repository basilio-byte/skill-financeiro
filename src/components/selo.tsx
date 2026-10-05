import { cn } from "@/lib/ui";

type Tom = "neutro" | "bom" | "atencao" | "critico" | "info";

const TONS: Record<Tom, string> = {
  neutro: "border-slate-200 bg-slate-50 text-slate-600",
  bom: "border-emerald-100 bg-emerald-50 text-emerald-700",
  atencao: "border-amber-200 bg-amber-50 text-amber-800",
  critico: "border-red-200 bg-red-50 text-red-700",
  info: "border-seahub-200 bg-seahub-50 text-acento-texto",
};

/**
 * Selo de estado. ⚠ A cor NUNCA é o único sinal: o selo sempre carrega o texto do estado (o projeto já
 * corrigiu um bug real de contraste por confiar só em cor — ver progress.md).
 */
export function Selo({ tom = "neutro", children, className }: { tom?: Tom; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium leading-snug",
        TONS[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Estado de uma rodada de sincronização → tom. Valores desconhecidos ficam neutros (nunca somem). */
export function tomDoStatus(status: string): Tom {
  if (status === "DONE") return "bom";
  if (status === "FAILED") return "critico";
  if (status === "RUNNING") return "info";
  return "neutro";
}
