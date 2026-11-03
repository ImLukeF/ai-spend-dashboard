# Alerts

Channels are code config containing secret **names**. Defaults receive budget and enforcement events; set `receives:['sync']` for provider failures/recovery. A budget routes to its `channels`. Period-close events route only with `notifyOnClose:true`. Test alerts are queued by the admin endpoint and dispatched by the next tick.

```ts
{ id: 'hook', type: 'webhook', urlSecret: 'ALERT_WEBHOOK_URL', signingSecretSecret: 'ALERT_WEBHOOK_SECRET' }
{ id: 'slack', type: 'slack', webhookUrlSecret: 'SLACK_WEBHOOK_URL' }
{ id: 'phone', type: 'ntfy', topicUrlSecret: 'NTFY_TOPIC_URL', tokenSecret: 'NTFY_TOKEN' }
{ id: 'mail', type: 'email', transport: 'resend', apiKeySecret: 'RESEND_API_KEY', fromSecret: 'ALERT_EMAIL_FROM', toSecret: 'ALERT_EMAIL_TO' }
{ id: 'cf-mail', type: 'email', transport: 'cloudflare', fromSecret: 'ALERT_EMAIL_FROM', toSecret: 'ALERT_EMAIL_TO' }
```

Every destination is HTTPS and redirects are refused. A local-only ntfy exception requires both `allowInsecureLocalhost:true` and ignored `LOCAL_DEV=true`; only loopback HTTP is permitted. Missing secrets/bindings skip the delivery visibly. An absent Cloudflare EMAIL binding is never silently substituted with another transport.

## Signed webhook

Payload: `{type,id,timestamp,data}`. Budget data includes budget id/name/period/start/end, spent, limit, currency, taxIncluded, percent, threshold (for threshold events), forecast, basis micros, dataAsOf and dashboardUrl. Enforcement data contains action type, a truncated target and reason. No full key IDs or provider credentials belong in alerts.

[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) signs the exact JSON bytes using HMAC-SHA256. Headers are `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64>`). The signing secret format has the standard prefix followed by base64 key bytes, at least 16 decoded bytes. Generate and keep it as a secret.

Node verification (also check event IDs for replay):

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(headers, rawBody, secret, nowSeconds) {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  if (!id || !ts || Math.abs(nowSeconds - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return (headers.get("webhook-signature") || "").split(" ").some((part) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
```

## Slack, ntfy and email

Create a Slack incoming webhook and save its URL as a secret. Messages use the plain-text summary; no SDK or external UI assets are loaded.

Use a private/authenticated ntfy topic where possible: public topic URLs act like passwords. Put the entire URL in the secret, and optionally supply a bearer-token secret. Messages have bounded UTF-8 text, a title of at most 100 characters, priority 3 for warnings, 4 for exceeded/forecast, and 5 for applied/failed enforcement. ntfy.sh currently documents a 250-message/day limit; self-hosted policies differ. [ntfy publish docs](https://docs.ntfy.sh/publish/).

Resend uses its fixed send-email API and `Idempotency-Key: <event>-<channel>`. Set sender/recipient values as secrets, including comma-separated recipients. HTML is escaped; text is included too. Cloudflare's optional `send_email` binding named `EMAIL` uses the installed runtime's message-builder send overload. Email Service is beta; full sending needs Workers Paid and verified-destination sending is the limited Free alternative. Check availability in your account before choosing this transport.

## Delivery and retry

Events and pending deliveries are inserted atomically; dedupe cannot create duplicate deliveries. At most 20 deliveries are attempted per tick, inside resource limits. 2xx succeeds. Failures retry after 15 minutes, one hour and six hours, then stop after four attempts. The event ID stays stable across retries. Activity shows pending/sent/skipped/failed, attempts and redacted errors. Third consecutive sync failures generate a daily provider warning; recovery generates an event.
