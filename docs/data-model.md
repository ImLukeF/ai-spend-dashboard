# Data model and provenance

One D1 database, one account per provider. ISO timestamps are UTC and daily facts use UTC dates. Empty text dimensions use `''`, not NULL, to keep composite keys meaningful. Anthropic null workspace is Default workspace; null key is No key (Console).

| Table                         | Owns                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `schema_migrations`           | Applied schema versions                                                                               |
| `meta`                        | Data/config/tag versions, tick lease, dirty-day continuation, due dates and short-lived summary cache |
| `sync_state`                  | Job attempts/success, next due, redacted errors, paging/backfill cursors                              |
| `entities`                    | Selected provider key/workspace/project metadata; never key material or hints                         |
| `usage_hourly`, `usage_daily` | Narrow metric/quantity facts by provider/time/workspace/key/model/tier                                |
| `cost_daily`                  | Billed micro-USD by finest provider grain and raw line item                                           |
| `spend_daily`                 | Read/budget fact with billed/allocated/estimated basis and unpriced tokens                            |
| `effective_rates`             | Learned cost per million units from trailing billed samples                                           |
| `entity_tags`                 | First-match materialised dimension values                                                             |
| `fx_rates`                    | Daily USD cross-rates and source                                                                      |
| `budget_periods`              | Definition hash, spend, limit, forecast, status and basis mix                                         |
| `events`, `deliveries`        | Deduped events plus per-channel durable delivery state                                                |
| `enforcement_actions`         | Unique period/action/target/mode, previous/applied snapshots, transitions                             |
| `audit_log`                   | Login hashes and administrative/enforcement records                                                   |
| `snapshot_stage`              | Transient rows for multi-chunk snapshots only; cleaned after use                                      |

Migrations are self-applied by the Worker in a D1 transaction. Concurrent isolates re-read the applied version after a migration race. Never edit a released migration or add a second migration system.

## Snapshot replacement

Only after every provider page validates, upsert a whole window and remove omitted rows in the same D1 batch. Bind rows as JSON and use json_each; unchanged facts write zero rows. Chunks are bounded to about 90 KB; multi-chunk windows use staging plus a final atomic upsert/delete batch. Incomplete pagination never deletes old data. A missing row in a successful revised snapshot is deliberately removed.

## Bases

- **Billed:** provider-reported amount. OpenAI/OpenRouter have per-key billed amounts. Anthropic costs without matching usage stay billed and unattributed.
- **Allocated:** Anthropic costs split across matching key usage by workspace/model/metric/tier. Batch stays separate; priority is excluded. Largest-remainder integer allocation preserves the billed total exactly, including negative credits. Web search uses request counts. Context window/speed/geography differences within a model are approximated.
- **Estimated:** only when the entire provider-day lacks costs, plus Anthropic priority usage (absent from costs). Config overrides win over learned trailing rates. Unknown token prices count as unpriced; no static price table is shipped. Billed rows replace estimates when they arrive. Partial billed days may understate spend until complete.

Changed provider-days are queued durably so work can continue within Free-plan query bounds. Avoid live enforcement while derived data is pending. Tags materialise from spend/entities, not raw key hints.

Hourly facts retain 14 days by default. Daily facts/FX/budget periods keep forever unless `retention.dailyDays` is set. Events/deliveries/actions/audit retain 400 days by default, preserving applied or unresolved restore actions. Costs and usage are reported aggregates, not invoice reconciliation.
