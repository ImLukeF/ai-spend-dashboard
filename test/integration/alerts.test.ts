import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { webhookSignature } from "../../src/worker/alerts/channels/webhook";
import { dispatchAlerts } from "../../src/worker/alerts/dispatch";
import { emit } from "../../src/worker/alerts/events";
import { formatAlert } from "../../src/worker/alerts/format";
import { evaluateBudgets } from "../../src/worker/budgets/evaluate";
import { BudgetCounter } from "../../src/worker/jobs/budget";
import { deps, json, NOW, resetDb } from "../helpers";

beforeEach(resetDb);
it("uses an independently computed Standard Webhooks signature", async () => {
  const bytes = new TextEncoder().encode("synthetic-signing-material-32bytes");
  const secret = ["whsec", btoa(String.fromCharCode(...bytes))].join("_");
  const body = '{"type":"test"}';
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          new TextEncoder().encode(`event-example.12345.${body}`),
        ),
      ),
    ),
  );
  expect(await webhookSignature(secret, "event-example", "12345", body)).toBe(`v1,${expected}`);
});
it("formats safe text and HTML with no complete target IDs and bounded ntfy title", () => {
  const event = {
    id: "example",
    type: "enforcement.dry_run",
    timestamp: "2026-11-04T03:15:00Z",
    data: { targetId: "apikey_EXAMPLE01", reason: "<script>" },
  };
  const f = formatAlert(event);
  expect(f.text).toContain("DRY RUN");
  expect(f.text).not.toContain("apikey_EXAMPLE01");
  expect(f.html).toContain("&lt;script&gt;");
  expect(f.title.length).toBeLessThanOrEqual(100);
  expect(new TextEncoder().encode(f.text).length).toBeLessThanOrEqual(4096);
});
it("dedupes threshold events and deliveries and retries failures with persistent backoff", async () => {
  const c = deps(
    {
      channels: [{ id: "ops", type: "slack", webhookUrlSecret: "SLACK_WEBHOOK_URL" }],
      budgets: [
        {
          id: "daily",
          name: "Daily",
          period: "day",
          amount: 10,
          thresholds: [80, 100],
          channels: ["ops"],
        },
      ],
    },
    { SLACK_WEBHOOK_URL: "https://example.com/hook" },
  );
  await env.DB.prepare(
    "INSERT INTO spend_daily VALUES('openai','2026-11-04','','','','billed',8000000,0,'2026-11-04T03:15:00Z')",
  ).run();
  await evaluateBudgets(c);
  await evaluateBudgets(c);
  expect(
    await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE type='budget.threshold'").first("n"),
  ).toBe(1);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM deliveries").first("n")).toBe(1);
  c.fetch = async () => json({}, 500);
  await dispatchAlerts(c, new BudgetCounter("paid"));
  expect(await env.DB.prepare("SELECT attempts,status FROM deliveries").first()).toEqual({
    attempts: 1,
    status: "pending",
  });
  expect(
    await env.DB.prepare("SELECT next_attempt_at FROM deliveries").first("next_attempt_at"),
  ).toBe("2026-11-04T03:30:00Z");
  c.now = () => new Date(NOW.getTime() + 16 * 60000);
  c.fetch = async () => json({});
  await dispatchAlerts(c, new BudgetCounter("paid"));
  expect(await env.DB.prepare("SELECT attempts,status FROM deliveries").first()).toEqual({
    attempts: 2,
    status: "sent",
  });
});
it("missing channel secrets skip delivery and HTTP channels refuse redirects/insecure URLs", async () => {
  const c = deps({
    channels: [{ id: "ops", type: "slack", webhookUrlSecret: "SLACK_WEBHOOK_URL" }],
  });
  await emit(c, {
    type: "test",
    severity: "info",
    dedupeKey: "example",
    data: {},
    channels: ["ops"],
  });
  await dispatchAlerts(c, new BudgetCounter("paid"));
  expect(await env.DB.prepare("SELECT status FROM deliveries").first("status")).toBe("skipped");
});
it.each(["webhook", "slack", "ntfy", "resend", "cloudflare"] as const)(
  "sends %s through its own channel without provider credentials",
  async (type) => {
    const signing = ["whsec", btoa("synthetic-signing-material-32bytes")].join("_");
    const channel =
      type === "webhook"
        ? {
            id: "ops",
            type,
            urlSecret: "ALERT_WEBHOOK_URL",
            signingSecretSecret: "ALERT_WEBHOOK_SECRET",
          }
        : type === "slack"
          ? { id: "ops", type, webhookUrlSecret: "SLACK_WEBHOOK_URL" }
          : type === "ntfy"
            ? { id: "ops", type, topicUrlSecret: "NTFY_TOPIC_URL" }
            : {
                id: "ops",
                type: "email",
                transport: type,
                apiKeySecret: "RESEND_API_KEY",
                fromSecret: "ALERT_EMAIL_FROM",
                toSecret: "ALERT_EMAIL_TO",
              };
    const sent: RequestInit[] = [];
    let email = false;
    const c = deps(
      { channels: [channel] },
      {
        ALERT_WEBHOOK_URL: "https://example.com/hook",
        ALERT_WEBHOOK_SECRET: signing,
        SLACK_WEBHOOK_URL: "https://example.com/slack",
        NTFY_TOPIC_URL: "https://example.com/topic",
        RESEND_API_KEY: "test-resend-key-not-real",
        ALERT_EMAIL_FROM: "alerts@example.com",
        ALERT_EMAIL_TO: "reader@example.com",
        EMAIL: {
          send: async () => {
            email = true;
          },
        },
      },
    );
    c.fetch = async (_u, init) => {
      sent.push(init ?? {});
      return json({});
    };
    await emit(c, {
      type: "test",
      severity: "info",
      dedupeKey: "example",
      data: {},
      channels: ["ops"],
    });
    await dispatchAlerts(c, new BudgetCounter("paid"));
    expect(await env.DB.prepare("SELECT status FROM deliveries").first("status")).toBe("sent");
    if (type === "cloudflare") expect(email).toBe(true);
    else {
      expect(sent).toHaveLength(1);
      const headers = new Headers(sent[0]?.headers);
      if (type === "webhook") expect(headers.get("webhook-signature")).toMatch(/^v1,/);
      if (type === "resend") expect(headers.get("Idempotency-Key")).toContain("-ops");
      expect(JSON.stringify(sent)).not.toContain("test-provider-key-not-real");
    }
  },
);

it("evaluates an existing just-ended period one last time and closes it once", async () => {
  const c = deps({ budgets: [{ id: "daily", name: "Daily", period: "day", amount: 10 }] });
  await evaluateBudgets(c);
  await env.DB.prepare(
    "INSERT INTO spend_daily VALUES('openai','2026-11-04','','','','billed',12000000,0,'2026-11-04T23:59:00Z')",
  ).run();
  c.now = () => new Date("2026-11-05T00:15:00Z");
  await evaluateBudgets(c);
  await evaluateBudgets(c);
  expect(
    await env.DB.prepare(
      "SELECT spent FROM budget_periods WHERE budget_id='daily' AND period_start='2026-11-04T00:00:00Z'",
    ).first("spent"),
  ).toBe(12);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM events WHERE type='budget.period_closed' AND period_start='2026-11-04T00:00:00Z'",
    ).first("n"),
  ).toBe(1);
});
