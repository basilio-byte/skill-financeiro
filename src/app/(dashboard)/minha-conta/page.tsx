import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/app/(dashboard)/minha-conta/change-password-form";

export default async function MinhaContaPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <div className="card max-w-md">
        <h1 className="font-semibold text-slate-900">Minha conta</h1>
        <p className="text-sm text-slate-500">
          {user.name} · {user.email} · {user.role}
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
