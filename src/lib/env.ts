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

  // Agendador de sincronização automática (src/lib/scheduler/auto-sync.ts,
  // ADR-0013) — roda em processo, dentro do próprio servidor Next.js.
  // NÃO usar z.coerce.boolean() aqui: `Boolean("false")` é `true` em JS, então
  // coerce trataria SYNC_AUTO_ENABLED=false como ligado — comparação explícita
  // com a string "true" evita essa pegadinha.
  SYNC_AUTO_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

  // Carência do mês anterior (ADR-0030). Até então um mês parava de ser
  // sincronizado no instante em que virava, e ficava permanentemente defasado
  // do Conexa nos dois sentidos (baixa retroativa nunca entrava; linha que
  // sumiu do Conexa nunca saía) — medido em agosto/2026: R$ 10,10.
  // `nonnegative`, e não `positive`: 0 é um valor válido e significa
  // "desligar a carência" (computeCarenciaWindow devolve null), útil para
  // reverter o comportamento por variável de ambiente, sem redeploy de código.
  SYNC_CARENCIA_DIAS: z.coerce.number().int().nonnegative().default(10),
  // Piso de tempo entre duas rodadas de carência. Não é urgência de 15 min:
  // sem esse piso, cada tick pediria um login e dois exports a mais ao Conexa
  // (sistema de terceiro) durante 10 dias de todo mês, sem ganho.
  SYNC_CARENCIA_INTERVALO_MINUTOS: z.coerce.number().int().positive().default(60),

  // Inadimplência (ADR-0031) — lê cobranças em aberto pela API REST v2 do
  // Conexa (token Bearer), NÃO pelo login web: aqui não há filtro de Data de
  // Crédito para justificar o export, e a API filtra status/vencimento no
  // servidor em vez de baixar o histórico inteiro. Opcional: sem token a
  // sincronização some em silêncio e o resto do app segue idêntico.
  CONEXA_API_TOKEN: z.string().default(""),
  // ⚠ Base PRÓPRIA da API v2: ela não mora na raiz do site (que serve a tela admin em
  // HTML), e CONEXA_BASE_URL é a raiz — usada pelo cliente web. Reaproveitá-la fez a
  // sincronização de inadimplência receber HTML ("Unexpected token '<'") em produção.
  CONEXA_API_BASE_URL: z.string().url().default("https://seahubcoworking.conexa.app/index.php/api/v2"),
  // Teto da API medido pelo comercial: 60 req/min. 30 deixa folga para o
  // outro serviço que usa o mesmo token.
  CONEXA_API_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(60).default(30),
  // Interruptor: false desliga a sincronização sem redeploy de código.
  INADIMPLENTES_SYNC_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  // Dívida muda devagar; não precisa de tick de 15 min.
  INADIMPLENTES_SYNC_INTERVALO_MINUTOS: z.coerce.number().int().positive().default(120),

  // MCP (ADR-0033): "on" remove TODA ferramenta de escrita de tools/list E recusa a chamada
  // direta com um motivo legível — interruptor de emergência, sem redeploy de código.
  MCP_SOMENTE_LEITURA: z.string().default("off"),

  // Integração ClickUp (ADR-0023) — token pessoal (`pk_...`), enviado como
  // header Authorization cru (sem "Bearer"). Opcional: sem ele, o push some
  // silenciosamente do log em vez de derrubar o boot do app (ver
  // src/lib/clickup/push.ts) — a sincronização de receita não pode depender
  // desta integração para funcionar.
  CLICKUP_API_TOKEN: z.string().default(""),
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

/** true quando há token da API v2 do Conexa (inadimplência, ADR-0031). */
export function hasConexaApiToken(): boolean {
  return getEnv().CONEXA_API_TOKEN.length > 0;
}

/** true quando há token configurado para a integração ClickUp. */
export function hasClickUpToken(): boolean {
  return getEnv().CLICKUP_API_TOKEN.length > 0;
}
