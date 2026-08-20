import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      // The factory-made entrypoint defeats esbuild export-guessing.
      additionalExports: { TaskExecutor: "WorkerEntrypoint" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
