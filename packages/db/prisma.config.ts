import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

for (const candidate of [".env", "../../.env"]) {
  const file = path.resolve(process.cwd(), candidate);
  if (existsSync(file)) {
    config({ path: file });
    break;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Neon's pooled (pgbouncer) endpoint can't run migrations, so prefer the direct URL.
    // The placeholder lets `prisma generate` run in CI/Docker builds without a database.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
