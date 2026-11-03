// UNVERIFIED per account: optional Email Service availability; require the installed EMAIL binding. https://developers.cloudflare.com/email-service/
import type { Channel } from "../../shared/config-schema";
import { iso } from "../../shared/periods";
import type { Deps } from "../deps";
import { secret } from "../env";
import type { BudgetCounter } from "../jobs/budget";
import { redact } from "../lib/redact";
import { webhookSignature } from "./channels/webhook";
import { type AlertEvent, formatAlert } from "./format";
export function channelSecretNames(channel: Channel) {
  switch (channel.type) {
    case "webhook":
      return [channel.urlSecret, channel.signingSecretSecret];
    case "slack":
      return [channel.webhookUrlSecret];
    case "ntfy":
      return [channel.topicUrlSecret, ...(channel.tokenSecret ? [channel.tokenSecret] : [])];
    case "email":
      return [
        channel.fromSecret,
        channel.toSecret,
        ...(channel.transport === "resend" && channel.apiKeySecret ? [channel.apiKeySecret] : []),
      ];
  }
}
export function channelConfigured(deps: Deps, ch: Channel) {
  return (
    channelSecretNames(ch).every((n) => Boolean(secret(deps.env, n))) &&
    (ch.type !== "email" || ch.transport !== "cloudflare" || Boolean(deps.env.EMAIL))
  );
}
export class MissingChannelSecret extends Error {}
async function send(deps: Deps, ch: Channel, event: AlertEvent, budget: BudgetCounter) {
  if (!channelConfigured(deps, ch))
    throw new MissingChannelSecret("Channel secret or EMAIL binding not configured");
  const f = formatAlert(event);
  let url = "";
  let body = "";
  const headers = new Headers();
  if (ch.type === "email") {
    const message = {
      from: secret(deps.env, ch.fromSecret),
      to: secret(deps.env, ch.toSecret)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      subject: f.title,
      text: f.text,
      html: f.html,
    };
    if (ch.transport === "cloudflare") {
      if (!deps.env.EMAIL) throw new Error("send_email binding EMAIL not configured");
      budget.request();
      await deps.env.EMAIL.send(message);
      return;
    }
    url = "https://api.resend.com/emails";
    headers.set("Authorization", `Bearer ${secret(deps.env, ch.apiKeySecret ?? "")}`);
    headers.set("Idempotency-Key", `${event.id}-${ch.id}`);
    body = JSON.stringify(message);
    headers.set("content-type", "application/json");
  } else if (ch.type === "webhook") {
    url = secret(deps.env, ch.urlSecret);
    body = JSON.stringify(event);
    const ts = String(Math.floor(deps.now().getTime() / 1000));
    headers.set("webhook-id", event.id);
    headers.set("webhook-timestamp", ts);
    headers.set(
      "webhook-signature",
      await webhookSignature(secret(deps.env, ch.signingSecretSecret), event.id, ts, body),
    );
    headers.set("content-type", "application/json");
  } else if (ch.type === "slack") {
    url = secret(deps.env, ch.webhookUrlSecret);
    body = JSON.stringify({ text: f.text });
    headers.set("content-type", "application/json");
  } else {
    url = secret(deps.env, ch.topicUrlSecret);
    body = f.text;
    headers.set("Title", f.title.replace(/[^\x20-\x7e]/g, " "));
    headers.set("Priority", String(f.priority));
    headers.set(
      "Tags",
      event.type.startsWith("enforcement.") ? "rotating_light" : "money_with_wings",
    );
    if (deps.config.publicUrl) headers.set("Click", deps.config.publicUrl);
    if (ch.tokenSecret) headers.set("Authorization", `Bearer ${secret(deps.env, ch.tokenSecret)}`);
  }
  const parsed = new URL(url);
  const local =
    ch.type === "ntfy" &&
    ch.allowInsecureLocalhost &&
    parsed.protocol === "http:" &&
    parsed.hostname === "127.0.0.1" &&
    secret(deps.env, "LOCAL_DEV") === "true";
  if (parsed.protocol !== "https:" && !local) throw new Error("Channel URL requires HTTPS");
  if (parsed.username || parsed.password) throw new Error("Channel URL credentials refused");
  budget.request();
  const response = await deps.fetch(parsed, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(25000, Math.max(1, budget.deadline + 15000 - Date.now()))),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Channel HTTP ${response.status}`);
}
export async function dispatchAlerts(deps: Deps, budget: BudgetCounter) {
  const rows = await deps.env.DB.prepare(
    "SELECT d.*,e.payload FROM deliveries d JOIN events e ON e.id=d.event_id WHERE d.status='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) ORDER BY e.created_at LIMIT 20",
  )
    .bind(iso(deps.now()))
    .all<{ event_id: string; channel_id: string; attempts: number; payload: string }>();
  for (const row of rows.results) {
    if (!budget.fits(1, 1)) break;
    const channel = deps.config.channels.find((c) => c.id === row.channel_id);
    let status = "sent";
    let error: string | null = null;
    let next: string | null = null;
    let attempts = row.attempts;
    try {
      if (!channel) throw new MissingChannelSecret("Channel removed from config");
      await send(deps, channel, JSON.parse(row.payload), budget);
      attempts++;
    } catch (e) {
      error = e instanceof MissingChannelSecret ? e.message : redact(e);
      if (e instanceof MissingChannelSecret) status = "skipped";
      else {
        attempts++;
        status = attempts >= 4 ? "failed" : "pending";
        next = iso(
          new Date(deps.now().getTime() + ([900000, 3600000, 21600000][attempts - 1] ?? 21600000)),
        );
      }
    }
    await deps.env.DB.prepare(
      "UPDATE deliveries SET status=?,attempts=?,next_attempt_at=?,sent_at=?,last_error=? WHERE event_id=? AND channel_id=?",
    )
      .bind(
        status,
        attempts,
        next,
        status === "sent" ? iso(deps.now()) : null,
        error,
        row.event_id,
        row.channel_id,
      )
      .run();
  }
}
