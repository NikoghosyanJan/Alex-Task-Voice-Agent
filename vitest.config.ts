import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    environment: "node",
  },
});
