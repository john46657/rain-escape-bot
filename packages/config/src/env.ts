/**
 * Zentrale, zod-validierte Konfiguration.
 *
 * Grundsaetze:
 *  - Secrets kommen ausschliesslich aus Umgebungsvariablen (Regel 45).
 *  - Ungueltige Konfiguration fuehrt zu einem Fail-Fast beim Start.
 *  - `DEV_MODE=true` erlaubt den Betrieb ohne PostgreSQL/Redis (SQLite +
 *    In-Memory-Cache), damit das Projekt lokal ohne Docker startbar ist.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();
loadDotenv({ path: '.env.local', override: true });

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? fallback : value === 'true' || value === '1'));

const snowflake = z.string().regex(/^\d{15,25}$/, 'Ungueltige Discord-Snowflake');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEV_MODE: bool(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_PRETTY: bool(false),

  // ---- Discord ----
  DISCORD_TOKEN: z.string().min(20).optional(),
  DISCORD_CLIENT_ID: snowflake.optional(),
  DISCORD_CLIENT_SECRET: z.string().min(10).optional(),
  DISCORD_DEV_GUILD_ID: snowflake.optional(),
  DISCORD_OWNER_IDS: z.string().default(''),
  DISCORD_SHARD_COUNT: z.coerce.number().int().positive().optional(),

  // ---- Persistenz ----
  DATABASE_PROVIDER: z.enum(['postgresql', 'sqlite']).default('postgresql'),
  DATABASE_URL: z.string().default('postgresql://nexus:nexus@localhost:5432/nexus?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PREFIX: z.string().default('nexus'),

  // ---- API ----
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me!!'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // ---- Roblox ----
  ROBLOX_API_KEY: z.string().optional(),
  /** HMAC-Secret fuer die Signatur der Game-Server-Requests (Regel 37). */
  ROBLOX_SIGNING_SECRET: z.string().min(16).default('dev-roblox-signing-secret-change'),
  ROBLOX_REQUEST_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  ROBLOX_GROUP_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),

  // ---- Optionale Integrationen ----
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  LAVALINK_HOST: z.string().optional(),
  LAVALINK_PORT: z.coerce.number().int().optional(),
  LAVALINK_PASSWORD: z.string().optional(),
  LAVALINK_SECURE: bool(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(overrides: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(overrides);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungueltige Umgebungskonfiguration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Nur fuer Tests: erzwingt ein Neuladen der Konfiguration. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const env = new Proxy({} as Env, {
  get: (_target, prop: string) => loadEnv()[prop as keyof Env],
});

export const ownerIds = (): string[] =>
  loadEnv()
    .DISCORD_OWNER_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

export const corsOrigins = (): string[] =>
  loadEnv()
    .CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
