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

// Neon's pooled (pgbouncer) endpoint can't run migrations, so prefer the direct URL.
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!databaseUrl && process.argv.includes("migrate")) {
  throw new Error(
    "DIRECT_URL / DATABASE_URL is not set. On Vercel, add both under Settings > Environment Variables for this environment.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // The placeholder lets `prisma generate` run in CI/Docker builds without a database.
    url: databaseUrl ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
