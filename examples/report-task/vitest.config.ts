import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Integration tests only (design/002 §6): the example worker is the MAIN
// worker, so the pool's DO helpers (runDurableObjectAlarm, evictDurableObject)
// reach the re-exported TaskRunner.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The factory-made entrypoint defeats esbuild export-guessing.
      additionalExports: { TaskExecutor: "WorkerEntrypoint" },
      miniflare: {
        // workerd egress cannot be intercepted by msw/node, so the report API
        // the worker fetches (env.REPORT_API_URL) is a real auxiliary workerd
        // worker: ALL outbound fetch from the example worker (and from the
        // tests, which share its isolate) is served by it. It counts requests
        // per recipient and injects /send failures for flaky-N-* recipients —
        // observable from tests via GET /__counts.
        outboundService: "report-api",
        workers: [
          {
            name: "report-api",
            modules: true,
            scriptPath: "./test/support/report-api.js",
            compatibilityDate: "2026-08-20",
          },
        ],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
