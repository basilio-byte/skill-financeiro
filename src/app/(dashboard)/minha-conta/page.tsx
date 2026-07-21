import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { Card, SectionTitle } from "@/components/ui";
import { ChangePasswordForm } from "@/components/contas-panel";

export const metadata: Metadata = { title: "Minha conta" };

export default async function MinhaContaPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-md">
        <h1 className="font-semibold text-slate-900">Minha conta</h1>
        <p className="text-sm text-slate-500">
          {user.name} · {user.email} · {user.role === "ADMIN" ? "Administrador" : "Visualizador"}
        </p>
      </Card>
      <Card className="max-w-md">
        <SectionTitle>Trocar senha</SectionTitle>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
