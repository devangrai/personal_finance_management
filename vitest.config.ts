import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      "@portfolio/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@portfolio/ai": path.resolve(__dirname, "packages/ai/src/index.ts"),
      "@portfolio/plaid": path.resolve(__dirname, "packages/plaid/src/index.ts"),
      "@portfolio/finance-core": path.resolve(
        __dirname,
        "packages/finance-core/src/index.ts"
      )
    }
  },
  test: {
    include: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
    testTimeout: 15_000,
    // Agent tests need DATABASE_URL + GEMINI_API_KEY from .env.
    env: loadEnvSync()
  }
});

function loadEnvSync(): Record<string, string> {
  const fs = require("node:fs") as typeof import("node:fs");
  const envPath = path.resolve(__dirname, ".env");
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}
