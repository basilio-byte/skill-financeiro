import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Inter, servida do próprio domínio (arquivo em src/app/fonts, licença OFL).
 *
 * ⚠ `next/font/local`, e não `next/font/google`: a variante do Google baixa o arquivo em tempo de build, e
 * uma falha de rede no runner derrubaria a imagem. O arquivo está no repositório — o build fica offline.
 */
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--fonte-inter",
  display: "swap",
  weight: "100 900",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Financeiro Seahub",
    template: "%s · Financeiro Seahub",
  },
  description: "Categorização de receita da Seahub Coworking, integrada ao ERP Conexa.",
};

// Acompanha o esquema do sistema: sem isto, a barra do navegador no celular fica clara sobre um painel escuro.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1016" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
