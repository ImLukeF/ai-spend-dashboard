# Providers and data limits

One account per provider. Every request uses a fixed HTTPS origin, no redirects, a 25-second timeout and validated JSON. Responses are capped at 10 MB, including streamed bodies. Retry 429/5xx up to three attempts, respecting Retry-After (seconds/date), bounded backoff and the tick's resource budget. Authentication and other 4xx failures are not retried. Incomplete/truncated snapshots are never committed. No prompt or completion data is collected.

This document records the plan's **UNVERIFIED** assumptions; fixture tests verify our handling, not live account availability. Provider APIs and permissions may change. No authenticated provider request was made during development, including OpenRouter analytics/meta: metric names follow the documented fixture contract and drift fails visibly.

## Anthropic

[Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api), [legacy usage/cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api), [API key management](https://platform.claude.com/docs/en/api/organization/api_keys/update).

Use an organisation Admin key, available to admins, not individual accounts. These keys have full access and no granular scopes. Headers are `x-api-key` and `anthropic-version: 2023-06-01`; parse key parentage from either `workspace_id` or `scope.workspace_id` (newer version shape).

| Endpoint                                  | Requested grouping / paging                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/v1/organizations/usage_report/messages` | key, workspace, model, service_tier; 1h/1d; `has_more` and `next_page`; at most 10 pages |
| `/v1/organizations/cost_report`           | workspace and description; 1d only; same paging                                          |
| `/v1/organizations/api_keys`              | limit 1000, after_id, status/workspace filters when needed                               |
| `/v1/organizations/workspaces`            | include archived, limit 1000, after_id                                                   |
| `/v1/organizations/api_keys/{id}`         | read current status, POST inactive; restore active                                       |

Usage counters are optional and default to zero. Null workspace means Default workspace; null key means No key (Console). Null cache/tool nested objects are accepted. Usage includes uncached input, cached reads, 5m/1h cache writes, output and web search request counts.

Cost amounts are decimal **cents**, parsed exactly to micro-USD. Token types map to their usage counterparts. Web search allocates by request counts; code execution, session usage and unknown costs remain billed/unattributed. Context window, speed and geography price differences are not separated across allocated keys; billed totals stay exact.

The legacy endpoints remain supported but are marked legacy. v1 uses them for their reported approximately five-minute data lag. The beta Analytics API is deferred: its refresh is approximately four hours and can take 24 hours; its newer split/reconciliation data is not imported here. Numeric endpoint rate limits are **UNVERIFIED**; v1 polls no more often than 15 minutes.

Priority-tier charges are absent from the cost report and are estimated. Flex/flex_discount usage mapping into standard cost is **UNVERIFIED**. Whether Console-billed coding-tool usage appears in the legacy messages report is **UNVERIFIED**. Console playground usage has no key. Code execution is cost-only. Cloud-managed Anthropic use (Bedrock, Vertex and Google-managed usage) is not covered.

Only active/inactive reversible key transitions are sent. Expired/inactive/archived keys are not reactivated by enforcement. Workspace archives and API-key archival are permanent and excluded. Workspace rate-limit overrides affect throughput, take time to apply and are not spend caps. The spend-limits API remains an early-access option and is not used. Prefer Console workspace native spend limits.

## OpenAI

[Admin APIs](https://developers.openai.com/api/docs/guides/admin-apis), [spend-limit behaviour](https://developers.openai.com/api/docs/guides/spend-limits), [Administration reference](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization).

Use an organisation owner-created Admin key in the Bearer header. Usage requires `api.usage.read`. No published numeric rate limit or data latency is assumed; both remain **UNVERIFIED**. Respect 429 Retry-After.

| Endpoint                                     | Requested grouping / paging                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/v1/organization/usage/completions`         | project_id, api_key_id, model, service_tier; repeated group_by; 1h/1d; next_page                                          |
| `/v1/organization/costs`                     | project_id, api_key_id, line_item; 1d only; next_page                                                                     |
| `/v1/organization/projects`                  | include archived; after cursor                                                                                            |
| `/v1/organization/projects/{id}/api_keys`    | after cursor; Free refreshes at most 10 projects in one entity pass, continues round-robin                                |
| `/v1/organization/projects/{id}/spend_limit` | GET snapshot (404 means none), POST one-cent monthly USD threshold; restore snapshot or DELETE only this reversible limit |

The completions endpoint covers token/request charts only. Embeddings, images, audio, vector stores, code interpreter, file/web search, moderation and decisions usage endpoints are not polled, but their money still arrives in Costs. Input includes cached/write tokens; subtract them unless explicit uncached input is present. Audio-specific counts are not double-counted.

The Costs API numeric value being **dollars** is an inference from its official example and remains **UNVERIFIED**. Strings parse exactly; numeric values round to micros. `1000_tokens` quantities multiply by 1000. Other quantity units do not train token rates. Best-effort `model, kind` line-item parsing and cached/input/output suffix meanings remain **UNVERIFIED**; unknown items preserve the raw description as `other`. Costs already provide per-key billed amounts; no allocation is used. User grouping is excluded because some user/project combinations are rejected.

Project hard limits reject affected traffic after propagation, which is **not instantaneous**. Whether setting one cent stops a project already above it immediately is **UNVERIFIED**. Test sandbox projects first. Native project/org hard limits and alerts are preferable to polling. No project archive, key deletion, rate clamp, key-scope change or organisation-level write is implemented; key-scope blocking semantics are **UNVERIFIED** and deliberately unused.

## OpenRouter

[Management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys), [keys API](https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys), [analytics](https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data), [cost-control cookbook](https://openrouter.ai/docs/cookbook/administration/analytics-cost-control).

Use an organisation management key (formerly provisioning key). Read-only keys work for reporting, but not enforcement. Workspace-scoped management keys return 403 on org endpoints. Management keys cannot call models. Numeric management rate limits and data latency are **UNVERIFIED**.

- `GET /api/v1/keys?include_disabled=true&offset=…`: page until zero rows or fewer than the previous page, at most 20 pages. Page size is **UNVERIFIED**. Store hashes as IDs and only selected non-secret limit/counter metadata. Daily/monthly counters are UTC; weeks start Monday.
- `POST /api/v1/analytics/query`: daily totals, request_count, tokens_prompt, tokens_completion; dimensions api_key_id/model (maximum two). Accept `date__day` or `created_at__day`, numeric strings and numbers. Metric vocabulary evolves; missing/invalid required metrics fail with SchemaDriftError. Historical reach is **UNVERIFIED**: backfill bounded config days and accept empty results.
- Truncated analytics ranges split at UTC day boundaries, at most three splits. Still-truncated results fail without replacing the snapshot. A single truncated day needs operator/provider investigation.
- Analytics key IDs are display names. Resolve exactly by name, then label. Duplicate/unknown names become `name:<value>` and must be treated as unattributed/ambiguous in the UI. No enforcement target is inferred from those names.
- `PATCH /api/v1/keys/{hash}` with only `disabled:true`; restore false after matching the applied state.

**Use native per-key `limit` and `limit_reset` as the primary cap**; the provider enforces them independently of this polling dashboard. BYOK limit inclusion is provider-configured metadata. `/activity` is an alternative report for the last 30 completed UTC days but cannot group by key; `/credits` only exposes lifetime totals. Neither is imported in v1.

## FX

[Frankfurter v2](https://frankfurter.dev/) requests `/v2/rates` with base USD, requested quotes, from/to dates and **providers=ECB**, avoiding blended sources. No key is needed. There is no published monthly/daily quota; abuse can be rate-limited. Weekends/holidays are absent; use the most recent preceding rate, or earliest following rate if necessary. The old `.app` host redirects and v1 API is deprecated; neither is used.

FX: ECB euro reference rates via Frankfurter; USD cross-rates are derived. For information only. Source: [ECB reuse disclaimer](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html).

Optional RBA series start 2023-01-03. The AUD/USD source's WM/Reuters redistribution terms are **UNVERIFIED**; use at your own discretion. Do not use open.er-api.com: its redistribution terms do not fit this project.

## Operational uncertainties

Free-plan CPU suitability is **UNVERIFIED** even with bounded subrequests and SQL aggregation. The deploy UI accepting empty optional secrets is **UNVERIFIED**; enter `-`. Cloudflare Email Service is beta, full sending requires Workers Paid, and verified-destination sending is the Free alternative; check your account's current binding availability.

Provider API amounts being pre-tax and Anthropic/OpenAI Australian GST invoice treatment are **UNVERIFIED**. The product only applies a user-configured percentage. No tax advice or invoice reconciliation is implied.

## Later

No adapters exist yet for xAI, Fireworks, Together, GitHub Copilot, Cursor, Mistral, Vercel Gateway, Google/AWS/Azure billing, DeepSeek or Moonshot. Availability depends on provider/account plans; do not assume a public billing API for other vendors. Re-check official documentation before adding one. No claims of coverage beyond the three implemented providers are made.
