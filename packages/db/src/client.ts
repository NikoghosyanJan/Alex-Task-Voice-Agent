import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __taskbotPrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
  return new PrismaClient({ adapter });
}

/** Lazily created singleton, reused across hot reloads and serverless invocations. */
export function getPrisma(): PrismaClient {
  globalForPrisma.__taskbotPrisma ??= createPrismaClient();
  return globalForPrisma.__taskbotPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  await globalForPrisma.__taskbotPrisma?.$disconnect();
  globalForPrisma.__taskbotPrisma = undefined;
}
