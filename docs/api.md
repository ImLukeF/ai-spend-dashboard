# HTTP API

All routes use `/api/v1`, no-store responses and structured errors `{error:{code,message}}`. Health returns only `{ok:true}` without credentials. Other routes need a verified Access JWT or signed session, subject to [auth](auth.md).

| Method/path                    | Capability           | Result                                                                       |
| ------------------------------ | -------------------- | ---------------------------------------------------------------------------- |
| GET `/health`                  | Public               | Minimal health                                                               |
| POST `/session`                | Public, token mode   | Login with `{token}`, set signed cookie                                      |
| DELETE `/session`              | Session/admin + CSRF | Clear cookie                                                                 |
| GET `/me`                      | Viewer               | Auth mode, identity, canAdmin                                                |
| GET `/summary`                 | Viewer or read token | Daily/weekly/monthly totals, forecast, bases, budgets and freshness          |
| GET `/spend`                   | Viewer or read token | `{rows,currency,taxIncluded,warnings}`                                       |
| GET `/usage`                   | Viewer               | `{rows:[{bucket,group,quantity}]}`                                           |
| GET `/budgets`, `/budgets/:id` | Viewer or read token | Current budgets; detail with history/events/actions                          |
| GET `/entities`                | Viewer               | Keys/workspaces with tags/status and MTD USD                                 |
| GET `/events`                  | Viewer               | Event feed with deliveries                                                   |
| GET `/status`                  | Viewer               | Job state, config/schema/version, channels/secret booleans, FX and last tick |
| GET `/config`                  | Viewer               | Effective config, secret names and configured booleans                       |
| GET `/export/spend.csv`        | Viewer               | Daily USD/display spend, names, IDs, model, basis, tag dimensions            |
| POST `/admin/sync`             | Admin + CSRF         | Queue tick, at most once per five minutes                                    |
| POST `/admin/test-alert`       | Admin + CSRF         | `{channelId}`, queue event, at most once per minute                          |

POST/DELETE need JSON, `x-asd-csrf:1` and same/missing Origin. Bodies are limited to 16 KB. There are no config/budget/provider-key write endpoints. Sync uses waitUntil and the same tick lease as cron; 202 means queued, not completed. Check status afterward. Alerts dispatch on a subsequent tick.

## Queries

Spend/usage/CSV accept `from`, `to` (inclusive UTC dates, ordered, at most 400 days), `groupBy=provider|workspace|api_key|model|tag:<dimension>`, `provider`, `workspace`, `apiKey`, `model`, `tag=dimension:value`. Spend accepts a configured display `currency` and `tax=0|1`. Defaults are 30 days and provider grouping. Spend groups display top eight groups by total and Other; raw CSV preserves rows. Amounts have basis mix in micro-USD, token/request counts and unpriced tokens. USD fallback includes warnings if FX is absent.

Usage accepts `granularity=hour|day`, `metric=tokens|requests`; hourly queries cannot extend past configured retention. Tokens sum input metrics and output only. Entities accept provider/kind. Events accept a type prefix, `limit=1..200` (default 50), and ISO `before` cursor. Budget history returns up to 12 periods.

## Read token for agents

Set an independent READ_API_TOKEN and load its value into your shell securely. The following command uses a variable, not a committed credential:

```sh
curl --fail-with-body --silent \
  -H "Authorization: Bearer $READ_API_TOKEN" \
  'https://spend.example.com/api/v1/budgets'
```

This token can GET only summary/spend/budgets; all other endpoints return 403. MCP and local collector ingest are deferred, not present in v1.
