import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

// In Docker the variables come from env_file; locally fall back to the repo-root .env.
for (const candidate of [".env", "../../.env"]) {
  const file = path.resolve(process.cwd(), candidate);
  if (existsSync(file)) {
    config({ path: file });
    break;
  }
}

process.env.SERVICE_NAME ??= "worker";
