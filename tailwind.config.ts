import type { Config } from "tailwindcss";

/**
 * As cores vêm de custom properties em globals.css (tema claro e escuro trocam num lugar só).
 *
 * ⚠ Por que TRIPLETOS (`--x: 12 34 56`) e `rgb(var(--x) / <alpha-value>)`: o código usa modificadores
 * de transparência (`bg-slate-50/60`, `bg-amber-50/40`), e isso só funciona se o Tailwind puder compor
 * o canal alfa — uma cor `var(--x)` opaca quebraria esses casos em silêncio.
 *
 * As escalas `slate`, `seahub`, `red`, `emerald`, `amber` e `orange` mantêm os MESMOS NOMES que o código
 * já usa (por isso nenhuma tela precisa trocar de classe): o que mudou foi o que cada degrau significa.
 * No escuro, os degraus se invertem de propósito (slate-900 vira quase branco) — o texto "escuro sobre
 * claro" vira "claro sobre escuro" sem tocar em JSX.
 */
const tom = (nome: string) => `rgb(var(--${nome}) / <alpha-value>)`;
const escala = (base: string, degraus: number[]) =>
  Object.fromEntries(degraus.map((d) => [d, tom(`${base}-${d}`)]));

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Superfícies
        plano: tom("c-plano"),
        card: tom("c-card"),
        "card-2": tom("c-card-2"),
        // Neutros e semânticas (mesmos nomes de antes)
        slate: escala("slate", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        seahub: escala("seahub", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        red: escala("red", [50, 100, 200, 300, 500, 600, 700, 800]),
        emerald: escala("emerald", [50, 100, 600, 700, 800]),
        amber: escala("amber", [50, 100, 200, 300, 700, 800, 900]),
        orange: escala("orange", [100, 800]),
        // Cor de TEXTO do acento (link, rótulo ativo): clara no escuro, escura no claro.
        // Separada do `seahub-600` porque aquele também é FUNDO de botão, e o mesmo degrau não
        // serve para as duas coisas nos dois temas.
        "acento-texto": tom("acento-texto"),
        marca: tom("marca"),
        // legados (mantidos: o código antigo referencia positive/negative/warning)
        positive: tom("emerald-600"),
        negative: tom("red-600"),
        warning: tom("amber-700"),
      },
      fontFamily: {
        sans: ["var(--fonte)"],
      },
      boxShadow: {
        1: "var(--sombra-1)",
        2: "var(--sombra-2)",
        3: "var(--sombra-3)",
      },
      backgroundImage: {
        marca: "linear-gradient(168deg, var(--marca-topo) 0%, var(--marca-base) 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
