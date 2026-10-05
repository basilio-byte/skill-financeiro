import { IconInfo } from "@/components/icons";
import { cn } from "@/lib/ui";

/**
 * Dica (ⓘ): leva o texto explicativo para fora da página sem perdê-lo.
 *
 * ⚠ A regra editorial do painel é "o dado primeiro": parágrafos de explicação entre o título e o número
 * competiam com o que importa. Mas o texto existe por rigor (o que é "S" no rateio, por que um total pode
 * ser um retrato antigo), então NÃO é removido — fica a um passo, por mouse OU teclado (o botão recebe
 * foco), e é lido por leitor de tela (o texto vai no `aria-label`).
 *
 * CSS puro, sem estado: funciona em componente de servidor e não adiciona JavaScript de cliente.
 */
export function Dica({
  children,
  alinhar = "esquerda",
  className,
}: {
  /** Texto da dica. Prefira string (vira o `aria-label` e o `title`). */
  children: React.ReactNode;
  /** Para onde o balão abre: use "direita" quando o ícone estiver perto da borda direita. */
  alinhar?: "esquerda" | "direita";
  className?: string;
}) {
  const texto = typeof children === "string" ? children : undefined;
  return (
    <span className={cn("group relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={texto ?? "Mais informações"}
        title={texto}
        className="rounded-full p-0.5 text-slate-400 transition-colors hover:text-slate-600 focus-visible:text-slate-600"
      >
        <IconInfo size={15} />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute top-full z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-card p-3 text-left text-[12.5px] font-normal normal-case leading-relaxed tracking-normal text-slate-600 opacity-0 shadow-3 transition-opacity duration-150",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          alinhar === "direita" ? "right-0" : "left-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}
