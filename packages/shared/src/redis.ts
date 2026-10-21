import { Redis, type RedisOptions } from "ioredis";
import { requireEnv } from "./env";
import { logger } from "./logger";

const globalForRedis = globalThis as unknown as { __taskbotRedis?: Redis };

/**
 * New dedicated connection. `rediss://` URLs (Upstash) enable TLS automatically.
 * BullMQ workers and Pub/Sub subscribers need their own connection with
 * `maxRetriesPerRequest: null`, which is the default here.
 */
export function createRedisConnection(options: RedisOptions = {}): Redis {
  const client = new Redis(requireEnv("REDIS_URL"), {
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    ...options,
  });
  client.on("error", (err) => {
    logger.warn({ err: err.message, connection: options.connectionName }, "redis connection error");
  });
  return client;
}

/**
 * Shared connection for short commands (dedupe keys, locks, publish, enqueueing).
 * Fails fast instead of queueing forever so HTTP handlers can return an error.
 */
export function getRedis(): Redis {
  globalForRedis.__taskbotRedis ??= createRedisConnection({
    connectionName: "taskbot:shared",
    maxRetriesPerRequest: 2,
  });
  return globalForRedis.__taskbotRedis;
}

export async function closeSharedRedis(): Promise<void> {
  const client = globalForRedis.__taskbotRedis;
  globalForRedis.__taskbotRedis = undefined;
  await client?.quit().catch(() => client.disconnect());
}
