import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./test/wrangler.test.jsonc" },
      miniflare: { bindings: { DASHBOARD_TOKEN: "test-dashboard-token-0123456789abcdef0123" } },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    maxWorkers: 2,
    fileParallelism: false,
  },
});
