/**
 * Cria o PRIMEIRO usuário administrador — para produção.
 *
 * Rodado automaticamente pelo docker-entrypoint.sh quando ADMIN_EMAIL e
 * ADMIN_PASSWORD estão definidos.
 *
 * IDEMPOTENTE e não-destrutivo: se o e-mail já existir, não faz nada — nunca
 * sobrescreve a senha de um usuário existente.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.ADMIN_NAME ?? "Administrador").trim();

if (!email || !password) {
  console.log("[bootstrap-admin] ADMIN_EMAIL/ADMIN_PASSWORD não definidos — pulando.");
  process.exit(0);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`[bootstrap-admin] ERRO: ADMIN_EMAIL inválido: ${email}`);
  process.exit(1);
}
if (password.length < 10) {
  console.error("[bootstrap-admin] ERRO: ADMIN_PASSWORD deve ter ao menos 10 caracteres.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[bootstrap-admin] usuário ${email} já existe — nada a fazer (senha preservada).`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { email, name, role: "ADMIN", passwordHash, isActive: true } });
    console.log(`[bootstrap-admin] administrador criado: ${email}`);
    console.log("[bootstrap-admin] ⚠ remova ADMIN_PASSWORD das variáveis após o primeiro acesso.");
  }
} catch (err) {
  console.error("[bootstrap-admin] ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
