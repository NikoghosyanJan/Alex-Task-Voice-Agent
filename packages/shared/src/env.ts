import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: optionalString,

  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  /** Override for local testing against a mock Bot API. */
  TELEGRAM_API_BASE: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_TRANSCRIBE_MODEL: optionalString,
  OPENAI_TASK_MODEL: optionalString,

  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,

  APP_URL: optionalString,
  VERCEL_PROJECT_PRODUCTION_URL: optionalString,
  WORKER_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["standalone", "serverless"]).default("standalone"),
  ),
  WORKER_SECRET: optionalString,
  CRON_SECRET: optionalString,
  APP_TIMEZONE: optionalString,
});

export type Env = z.infer<typeof envSchema>;

type OptionalKey = {
  [K in keyof Env]-?: undefined extends Env[K] ? K : never;
}[keyof Env];

let cached: Env | undefined;

/**
 * Every variable is optional at parse time so that builds and unrelated routes keep working;
 * features call `requireEnv` for the variables they actually need.
 */
export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

export function requireEnv<K extends OptionalKey & keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}

export function getAppUrl(): string {
  const env = getEnv();
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function getTimeZone(): string {
  return getEnv().APP_TIMEZONE ?? "UTC";
}

/** Only for tests. */
export function resetEnvCache(): void {
  cached = undefined;
}
