import { cn } from "@/lib/ui";
import { Dica } from "@/components/dica";

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-slate-200/80 bg-card p-5 shadow-1", className)} {...rest}>
      {children}
    </div>
  );
}

/** Acima disto, uma dica de seção deixa de caber ao lado do título e vira ⓘ. */
const DICA_CURTA = 34;

/**
 * Título de seção: caixa normal, peso forte — não é um "rótulo em maiúsculas" (o painel não tem eyebrows).
 *
 * `hint` curto (ex.: "12 pendente(s)") fica ao lado, como metadado; `hint` longo (uma frase explicativa)
 * vira o ícone ⓘ — o texto continua inteiro e acessível, só não disputa espaço com o dado.
 */
export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  const longa = !!hint && hint.length > DICA_CURTA;
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] text-slate-800">
        {children}
        {longa ? <Dica>{hint}</Dica> : null}
      </h2>
      {hint && !longa ? <span className="shrink-0 text-[12.5px] text-slate-500">{hint}</span> : null}
    </div>
  );
}
