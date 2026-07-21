import "server-only";
import { z } from "zod";

/**
 * Validação centralizada das variáveis de ambiente do servidor.
 * Falha rápido no boot se algo essencial estiver faltando.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("America/Fortaleza"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),

  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET deve ter ao menos 16 caracteres"),

  // Login web do Conexa (NÃO é o token da API v2 — a tela de export admin,
  // que é a única com o filtro "Data de Crédito da Cobrança", só aceita
  // sessão de usuário logado). Ver docs/context/conexa-integration.md.
  CONEXA_BASE_URL: z.string().url().default("https://seahubcoworking.conexa.app"),
  CONEXA_WEB_USERNAME: z.string().default(""),
  CONEXA_WEB_PASSWORD: z.string().default(""),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** true quando há credenciais configuradas para logar no Conexa. */
export function hasConexaWebCredentials(): boolean {
  const env = getEnv();
  return env.CONEXA_WEB_USERNAME.length > 0 && env.CONEXA_WEB_PASSWORD.length > 0;
}
