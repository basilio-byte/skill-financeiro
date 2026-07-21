import type { Config } from "tailwindcss";

/**
 * Paleta "seahub" — mesma usada no projeto irmão seahub_financeiro, para os
 * dois produtos terem identidade visual consistente.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        seahub: {
          50: "#eef6fb",
          100: "#d6e9f5",
          200: "#aed3ea",
          300: "#7db6dc",
          400: "#4a94c9",
          500: "#2a76ad",
          600: "#1f5c8c",
          700: "#1b4b72",
          800: "#1a3f5e",
          900: "#122b41",
          950: "#0b1b29",
        },
        positive: "#15803d",
        negative: "#b91c1c",
        warning: "#b45309",
      },
    },
  },
  plugins: [],
};

export default config;
