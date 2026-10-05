import { cn } from "@/lib/ui";

/**
 * Logotipo da Seahub — o ARQUIVO OFICIAL (`public/logo.png`, o mesmo do dash comercial).
 *
 * ⚠ É BRANCO sobre transparente. Por isso só pode aparecer sobre superfície ESCURA (a navegação lateral,
 * o painel de login e o cabeçalho móvel, que são sempre da cor da marca nos dois temas). Era o bug do
 * cabeçalho antigo: logo branco sobre um cabeçalho branco — invisível para quem não usava o Chrome
 * escuro. Não redesenhar em SVG: inventar identidade visual é o mesmo erro que inventar dado.
 *
 * `<img>` cru, e não `next/image`, de propósito: o build é `output: standalone` sem `sharp`, e o
 * otimizador de imagem do Next não é necessário para 28 KB.
 */
const PROPORCAO = 1280 / 440;

export function Logo({ altura = 22, className }: { altura?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Seahub"
      width={Math.round(altura * PROPORCAO)}
      height={altura}
      // `self-start`: dentro de um flex-column o padrão é `stretch`, que atropela o `width: auto` e achata o logo.
      className={cn("block max-w-none shrink-0 self-start", className)}
      style={{ height: altura, width: "auto" }}
    />
  );
}

/**
 * Assinatura: o logotipo mais o nome do painel. "financeiro" existe porque a Seahub tem mais de um
 * painel — sem ele, este e o comercial se apresentam iguais.
 */
export function Assinatura({ altura = 22, className }: { altura?: number; className?: string }) {
  return (
    <span className={cn("flex flex-col items-start gap-[5px]", className)}>
      <Logo altura={altura} />
      <span className="pl-[2px] text-[9px] font-semibold uppercase leading-none tracking-[0.2em] text-[var(--marca-tinta-3)]">
        financeiro
      </span>
    </span>
  );
}
