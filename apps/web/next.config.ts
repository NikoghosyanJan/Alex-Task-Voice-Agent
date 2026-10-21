import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");

const rootEnvFile = path.join(repoRoot, ".env");
if (existsSync(rootEnvFile)) {
  loadEnv({ path: rootEnvFile });
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  // Lets `next dev` serve hot reload through tunnels used for the Telegram webhook.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app", "*.trycloudflare.com"],
  transpilePackages: ["@taskbot/db", "@taskbot/shared", "@taskbot/jobs"],
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "pino",
    "pg",
    "@prisma/client",
    "@prisma/adapter-pg",
  ],
};

export default nextConfig;
