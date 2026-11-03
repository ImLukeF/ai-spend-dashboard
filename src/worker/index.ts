import { loadConfig } from "./config";
import { ensureSchema } from "./db/migrate";
import { setMeta } from "./db/repo/state";
import { defaultDeps } from "./deps";
import type { Bindings } from "./env";
import { createApp } from "./http/app";
import { SECURITY_HEADERS } from "./http/headers";
import { tick } from "./jobs/tick";
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    if (url.pathname === "/api/v1/health" && request.method === "GET")
      return Response.json(
        { ok: true },
        { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
      );
    const loaded = await loadConfig();
    if (!loaded.ok)
      return Response.json(
        { error: { code: "config_invalid", message: "Invalid spend.config.ts" } },
        { status: 503, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
      );
    return createApp(defaultDeps(env, loaded.config)).fetch(request, undefined, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    await ensureSchema(env.DB);
    const loaded = await loadConfig();
    if (!loaded.ok) {
      await setMeta(env.DB, "last_tick", { error: "Invalid config", errors: loaded.errors });
      return;
    }
    await setMeta(env.DB, "config_hash", loaded.hash);
    ctx.waitUntil(tick(defaultDeps(env, loaded.config)));
  },
} satisfies ExportedHandler<Bindings>;
