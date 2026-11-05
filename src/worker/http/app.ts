import { Hono } from "hono";
import { z } from "zod";
import { iso, period } from "../../shared/periods";
import { emit } from "../alerts/events";
import { ensureSchema } from "../db/migrate";
import { audit } from "../db/repo/state";
import type { Deps } from "../deps";
import { secret } from "../env";
import { tick } from "../jobs/tick";
import { hash } from "../lib/hash";
import { redact } from "../lib/redact";
import {
  authConfigured,
  authenticate,
  constantEqual,
  createSession,
  type Identity,
  SESSION_ATTRIBUTES,
} from "./auth";
import { requestJson, validCsrf } from "./csrf";
import { SECURITY_HEADERS } from "./headers";
import { budgets, exportCsv, InputError, queryParams, spend, status, summary, usage } from "./read";
export function createApp(deps: Deps) {
  const app = new Hono<{ Variables: { identity: Identity } }>();
  const error = (code: string, message: string) => ({ error: { code, message } });
  app.use("*", async (c, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
    c.header("cache-control", "no-store");
    await next();
  });
  app.onError((err, c) => {
    if (err instanceof InputError) return c.json(error("invalid_input", err.message), 400);
    deps.log({ error: redact(err) });
    return c.json(error("internal_error", "Request could not be completed"), 500);
  });
  app.get("/api/v1/health", (c) => c.json({ ok: true }));
  app.use("/api/*", async (c, next) => {
    if (!authConfigured(deps))
      return c.json(
        error("auth_not_configured", "Configure authentication before using the dashboard"),
        503,
      );
    await ensureSchema(deps.env.DB);
    if (c.req.path === "/api/v1/session" && c.req.method === "POST") return next();
    const identity = await authenticate(c.req.raw, deps);
    if (!identity) return c.json(error("unauthorized", "Sign in required"), 401);
    c.set("identity", identity);
    if (
      identity.authMode === "read-token" &&
      (c.req.method !== "GET" ||
        !/^\/api\/v1\/(summary|spend|budgets(?:\/[^/]+)?)$/.test(c.req.path))
    )
      return c.json(error("forbidden", "Read token is limited to summary, spend and budgets"), 403);
    if (c.req.method !== "GET" && (!identity.canAdmin || identity.authMode === "read-token"))
      return c.json(error("forbidden", "Admin access required"), 403);
    if ((c.req.method === "POST" || c.req.method === "DELETE") && !validCsrf(c.req.raw))
      return c.json(error("csrf", "Same-origin JSON request and x-asd-csrf header required"), 403);
    return next();
  });
  app.post("/api/v1/session", async (c) => {
    if (deps.config.auth.mode !== "token")
      return c.json(error("unsupported", "Token login is disabled"), 404);
    if (!validCsrf(c.req.raw)) return c.json(error("csrf", "JSON and CSRF header required"), 403);
    let raw: unknown;
    try {
      raw = await requestJson(c.req.raw);
    } catch {
      return c.json(error("invalid_input", "Invalid or oversized JSON"), 400);
    }
    const result = z.object({ token: z.string().max(4096) }).safeParse(raw);
    if (!result.success) return c.json(error("invalid_input", "Expected token"), 400);
    if (!(await constantEqual(result.data.token, secret(deps.env, "DASHBOARD_TOKEN")))) {
      await audit(deps.env.DB, iso(deps.now()), "token", "login_failed", {
        clientHash: (
          await hash(
            `${c.req.header("cf-connecting-ip") ?? "unknown"}${iso(deps.now()).slice(0, 10)}`,
          )
        ).slice(0, 16),
      });
      return c.json(error("unauthorized", "Invalid token"), 401);
    }
    c.header(
      "set-cookie",
      `asd_session=${await createSession(secret(deps.env, "DASHBOARD_TOKEN"), deps.now())}; ${SESSION_ATTRIBUTES}`,
    );
    await audit(deps.env.DB, iso(deps.now()), "token", "login");
    return c.json({ ok: true });
  });
  app.delete("/api/v1/session", (c) => {
    c.header("set-cookie", "asd_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
    return c.json({ ok: true });
  });
  app.get("/api/v1/me", (c) => c.json(c.get("identity")));
  app.get("/api/v1/config", async (c) =>
    c.json({ ...deps.config, configured: (await status(deps)).secrets }),
  );
  app.get("/api/v1/status", async (c) => c.json(await status(deps)));
  app.get("/api/v1/summary", async (c) =>
    c.json(await summary(deps, queryParams(new URL(c.req.url), deps))),
  );
  app.get("/api/v1/spend", async (c) =>
    c.json(await spend(deps, queryParams(new URL(c.req.url), deps))),
  );
  app.get("/api/v1/usage", async (c) =>
    c.json(await usage(deps, queryParams(new URL(c.req.url), deps))),
  );
  app.get("/api/v1/budgets", async (c) => c.json(await budgets(deps)));
  app.get("/api/v1/budgets/:id", async (c) => {
    const budget = (await budgets(deps)).budgets.find((b) => b.id === c.req.param("id"));
    if (!budget) return c.json(error("not_found", "Unknown budget"), 404);
    const [history, events, actions] = await Promise.all([
      deps.env.DB.prepare(
        "SELECT * FROM budget_periods WHERE budget_id=? ORDER BY period_start DESC LIMIT 12",
      )
        .bind(budget.id)
        .all(),
      deps.env.DB.prepare(
        "SELECT * FROM events WHERE budget_id=? ORDER BY created_at DESC LIMIT 50",
      )
        .bind(budget.id)
        .all(),
      deps.env.DB.prepare(
        "SELECT * FROM enforcement_actions WHERE budget_id=? ORDER BY created_at DESC LIMIT 50",
      )
        .bind(budget.id)
        .all(),
    ]);
    return c.json({
      budget,
      history: history.results,
      events: events.results,
      actions: actions.results,
    });
  });
  app.get("/api/v1/entities", async (c) => {
    const provider = c.req.query("provider");
    const kind = c.req.query("kind");
    if (
      (provider && !["anthropic", "openai", "openrouter"].includes(provider)) ||
      (kind && !["workspace", "api_key"].includes(kind))
    )
      return c.json(error("invalid_input", "Invalid entity filter"), 400);
    const rows = await deps.env.DB.prepare(
      `SELECT e.*,(SELECT name FROM entities w WHERE w.provider=e.provider AND w.kind='workspace' AND w.id=e.workspace_id) workspaceName,COALESCE((SELECT SUM(amount_micros)/1000000.0 FROM spend_daily s WHERE s.provider=e.provider AND s.day>=? AND s.day<=? AND (e.kind='api_key' AND s.api_key_id=e.id OR e.kind='workspace' AND s.workspace_id=e.id)),0) monthToDate FROM entities e WHERE (? IS NULL OR e.provider=?) AND (? IS NULL OR e.kind=?) ORDER BY e.provider,e.kind,e.name`,
    )
      .bind(
        period(deps.now(), "month").start.slice(0, 10),
        iso(deps.now()).slice(0, 10),
        provider ?? null,
        provider ?? null,
        kind ?? null,
        kind ?? null,
      )
      .all<Record<string, unknown>>();
    const tags = (
      await deps.env.DB.prepare("SELECT * FROM entity_tags").all<{
        provider: string;
        workspace_id: string;
        api_key_id: string;
        dimension: string;
        value: string;
      }>()
    ).results;
    return c.json({
      rows: rows.results.map((r) => ({
        ...r,
        meta: JSON.parse(String(r.meta)),
        tags: Object.fromEntries(
          tags
            .filter(
              (t) =>
                t.provider === r.provider &&
                (r.kind === "api_key" ? t.api_key_id === r.id : t.workspace_id === r.id),
            )
            .map((t) => [t.dimension, t.value]),
        ),
        protected: deps.config.enforcement.protectedKeyIds.includes(String(r.id)),
      })),
      currency: "USD",
      warnings: (
        await deps.env.DB.prepare(
          "SELECT DISTINCT api_key_id FROM spend_daily WHERE provider='openrouter' AND api_key_id LIKE 'name:%'",
        ).all<{ api_key_id: string }>()
      ).results.map((r) => `OpenRouter duplicate or unknown key name: ${r.api_key_id.slice(5)}`),
    });
  });
  app.get("/api/v1/events", async (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      return c.json(error("invalid_input", "limit must be 1..200"), 400);
    const before = c.req.query("before");
    if (before && !z.iso.datetime().safeParse(before).success)
      return c.json(error("invalid_input", "Invalid cursor"), 400);
    const type = c.req.query("type");
    if (type && !/^[a-z.]+$/.test(type))
      return c.json(error("invalid_input", "Invalid event type"), 400);
    const rows = (
      await deps.env.DB.prepare(
        "SELECT * FROM events WHERE (? IS NULL OR type LIKE ?) AND (? IS NULL OR created_at<?) ORDER BY created_at DESC,id DESC LIMIT ?",
      )
        .bind(type ?? null, type ? `${type}%` : null, before ?? null, before ?? null, limit)
        .all<Record<string, unknown>>()
    ).results;
    const deliveries = (
      await deps.env.DB.prepare(
        "SELECT * FROM deliveries WHERE event_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
      )
        .bind(JSON.stringify(rows))
        .all<Record<string, unknown>>()
    ).results;
    return c.json({
      rows: rows.map((r) => ({
        ...r,
        payload: JSON.parse(String(r.payload)),
        deliveries: deliveries.filter((d) => d.event_id === r.id),
      })),
    });
  });
  app.get("/api/v1/export/spend.csv", async (c) => {
    c.header("content-type", "text/csv; charset=utf-8");
    c.header("content-disposition", 'attachment; filename="burnrate.csv"');
    return c.body(await exportCsv(deps, queryParams(new URL(c.req.url), deps)));
  });
  async function throttle(key: string, ms: number) {
    const now = iso(deps.now());
    const result = await deps.env.DB.prepare(
      "INSERT INTO meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE v<=?3",
    )
      .bind(key, now, iso(new Date(deps.now().getTime() - ms)))
      .run();
    return result.meta.changes > 0;
  }
  app.post("/api/v1/admin/sync", async (c) => {
    try {
      await requestJson(c.req.raw);
    } catch {
      return c.json(error("invalid_input", "Invalid or oversized JSON"), 400);
    }
    if (!(await throttle("admin_sync_at", 300000)))
      return c.json(error("rate_limited", "Sync allowed once every five minutes"), 429);
    await audit(deps.env.DB, iso(deps.now()), c.get("identity").authMode, "sync_now");
    c.executionCtx.waitUntil(tick(deps));
    return c.json({ ok: true, queued: true }, 202);
  });
  app.post("/api/v1/admin/test-alert", async (c) => {
    let body: unknown;
    try {
      body = await requestJson(c.req.raw);
    } catch {
      return c.json(error("invalid_input", "Invalid or oversized JSON"), 400);
    }
    const value = z.object({ channelId: z.string().max(48) }).safeParse(body);
    if (!value.success || !deps.config.channels.some((ch) => ch.id === value.data.channelId))
      return c.json(error("invalid_input", "Unknown channel"), 400);
    if (!(await throttle("admin_test_at", 60000)))
      return c.json(error("rate_limited", "Test allowed once per minute"), 429);
    await emit(deps, {
      type: "test",
      severity: "info",
      dedupeKey: `test:${deps.randomId()}`,
      data: { dashboardUrl: deps.config.publicUrl || null },
      channels: [value.data.channelId],
    });
    await audit(deps.env.DB, iso(deps.now()), c.get("identity").authMode, "test_alert", {
      channelId: value.data.channelId,
    });
    return c.json({ ok: true }, 202);
  });
  app.notFound((c) => c.json(error("not_found", "Not found"), 404));
  return app;
}
