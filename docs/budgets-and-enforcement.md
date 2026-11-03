# Budgets and reversible enforcement

Budgets use UTC day, ISO week (Monday) or calendar month periods. `scope:{}` matches everything; provider/workspace/key/model/tag fields are ANDed, array members ORed. Model patterns support `*`. Every base (billed, allocated, estimated) contributes. Conversion is per day, with markup, then the configured percentage if `includeTax` is true.

A definition has `id`, `name`, `period`, positive `amount`, `currency`, `includeTax`, `scope`, sorted unique `thresholds`, `forecast`, `notifyOnClose`, `channels`, and optional `enforce`. Defaults: USD, no tax, 50/80/100%, forecast enabled, no close notification, no enforcement.

Thresholds fire once per budget/period/threshold/definition hash. Changing a definition deliberately resets its dedupe identity. Forecast is linear (`spent / elapsed hours × period hours`), week/month only, and can alert after 25% of the period. A just-ended period is evaluated once more, recorded and optionally notified. Missing usable FX blocks live enforcement; USD fallback amounts are indicative until rates arrive.

```ts
{
  id: 'bot-daily', name: 'Example bot', period: 'day', amount: 10,
  scope: { apiKeyIds: ['apikey_EXAMPLE01'] }, channels: ['phone'],
  enforce: {
    atPercent: 100, restoreAtPeriodEnd: true,
    actions: [{ type: 'anthropic.deactivate_api_key', apiKeyId: 'apikey_EXAMPLE01' }],
  },
}
```

## Dry-run walkthrough

1. Use a synthetic config/test fixture locally. In your own deployment, begin with a sandbox key/project.
2. Add a budget with an explicit enforcement target and at least one alert channel.
3. Leave `ENFORCEMENT_MODE` blank or `dry_run`. Review `enforcement.dry_run` events/actions in Activity and budget detail. No provider mutations occur.
4. Protect critical keys with `enforcement.protectedKeyIds` and check provider freshness, FX and target identity.
5. Only after sandbox validation, explicitly set the secret master mode to `live` in your own account. `off` records no new actions and performs no restores.

| Action                                | Apply                                                         | Restore                                           |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `anthropic.deactivate_api_key`        | POST status inactive                                          | POST previous active status                       |
| `anthropic.deactivate_workspace_keys` | Fresh active-key list capped at maxKeys; each key separately  | Each applied key separately                       |
| `openai.set_project_spend_limit`      | Snapshot existing monthly limit, POST threshold_amount 1 cent | POST snapshot or DELETE the limit if none existed |
| `openrouter.disable_key`              | PATCH disabled true                                           | PATCH prior false                                 |

Explicit targets only: budget scope never implies a write target. Targets must exist in entities and have been seen in 48 hours. Protected targets, missing FX, missing provider secrets, sync older than two hours and action caps skip live changes with an auditable reason. Defaults cap actions at 10/tick, 50/day. A unique target/action/budget/period/mode record prevents repeat writes. Dry-run has a distinct identity from live so deliberately enabling live later is possible.

Snapshots contain only reversible provider state. No archives, key deletion, admin-key management or org-level spend-limit writes. The one DELETE route removes **our reversible OpenAI project spend limit**, never a key/project.

Human overrides win. A refreshed Anthropic/OpenRouter key re-enabled during the period marks the action overridden, so it is not re-applied. Restores fetch current state and compare with applied state before restoring; a changed provider state becomes overridden. OpenAI overrides are detected only at restore time. Restore failures retry each tick for 24 hours and emit critical events. Keep the action definition when waiting for a restore; removing a budget or its restore opt-in stops automatic restoration.

**Lag is unavoidable:** 15-minute polling plus provider reporting lag; Anthropic typically adds about five minutes and OpenAI/OpenRouter lag is UNVERIFIED. OpenAI hard-limit propagation is not instantaneous; one-cent stop semantics are UNVERIFIED. Prefer native caps and sandbox-test first. This tool is a backstop, not a guaranteed maximum bill.
