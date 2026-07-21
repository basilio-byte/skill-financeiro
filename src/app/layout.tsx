import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Financeiro Seahub",
    template: "%s · Financeiro Seahub",
  },
  description: "Categorização de receita da Seahub Coworking, integrada ao ERP Conexa.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
