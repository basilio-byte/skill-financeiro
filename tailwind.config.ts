import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          500: "#2f6feb",
          600: "#2457c1",
          700: "#1b4396",
        },
      },
    },
  },
  plugins: [],
};

export default config;
