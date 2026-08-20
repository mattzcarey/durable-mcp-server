import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Pool-only config (Matt's testing update 2026-08-21): ALL package tests —
// pure logic included — run in workerd via the workers pool, against the
// fixture worker. Storage isolation is per test file; anything touching
// storage runs against real DO SQLite via runInDurableObject.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./test/fixtures/wrangler.jsonc" },
      // The factory-made entrypoint defeats esbuild export-guessing.
      additionalExports: { TaskExecutor: "WorkerEntrypoint" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
