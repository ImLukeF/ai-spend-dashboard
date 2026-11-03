import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [preact()],
  build: { outDir: "../../dist/web", emptyOutDir: true, modulePreload: { polyfill: false } },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8787" } },
});
