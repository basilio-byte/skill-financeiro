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

/**
 * Origem de uma rodada — o selo sempre leva o TEXTO, e a cor só reforça:
 * Automática (cinza) = o sistema baixou do Conexa sozinho; Manual (azul) = alguém disparou o
 * download pelo sistema; Importação (âmbar) = os arquivos vieram de uma pessoa, então o dado vale
 * só até onde o arquivo alcança. Valor desconhecido aparece como veio, em cinza (nunca some).
 */
export const ROTULO_ORIGEM: Record<string, string> = {
  AUTOMATICO: "Automática",
  MANUAL: "Manual",
  IMPORTACAO: "Importação",
};

export function tomDaOrigem(origem: string): Tom {
  if (origem === "MANUAL") return "info";
  if (origem === "IMPORTACAO") return "atencao";
  return "neutro";
}

/** Texto de ajuda das três origens, para o ⓘ das listas de sincronizações. */
export const AJUDA_ORIGEM =
  "Origem: Automática = o sistema baixou os exports do Conexa sozinho; Manual = alguém disparou o download pelo sistema; " +
  "Importação = os arquivos foram enviados por uma pessoa (o dado vale só até onde o arquivo alcança).";

/** Estado de uma rodada de sincronização → tom. Valores desconhecidos ficam neutros (nunca somem). */
export function tomDoStatus(status: string): Tom {
  if (status === "DONE") return "bom";
  if (status === "FAILED") return "critico";
  if (status === "RUNNING") return "info";
  return "neutro";
}
