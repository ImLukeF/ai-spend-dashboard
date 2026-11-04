import { env } from "cloudflare:workers";
import { ConfigSchema } from "../src/shared/config-schema";
import { ensureSchema } from "../src/worker/db/migrate";
import type { Deps } from "../src/worker/deps";
import type { Bindings } from "../src/worker/env";
export const NOW = new Date("2026-11-04T03:15:00Z");
export function deps(config: unknown = {}, bindings: Record<string, unknown> = {}): Deps {
  return {
    env: { ...env, ...bindings } as Bindings,
    config: ConfigSchema.parse(config),
    fetch: async () => {
      throw new Error("Unexpected mocked request");
    },
    now: () => new Date(NOW),
    randomId: () => crypto.randomUUID(),
    sleep: async () => {},
    log: () => {},
  };
}
export async function resetDb() {
  await ensureSchema(env.DB);
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*' AND name!='schema_migrations'",
  ).all<{ name: string }>();
  await env.DB.batch(tables.results.map((t) => env.DB.prepare(`DELETE FROM ${t.name}`)));
}
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
