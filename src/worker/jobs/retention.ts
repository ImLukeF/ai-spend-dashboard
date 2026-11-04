import { addDays, day, iso } from "../../shared/periods";
import type { Deps } from "../deps";
export async function retention(deps: Deps) {
  const db = deps.env.DB;
  const cutoff = iso(addDays(deps.now(), -deps.config.retention.eventsDays));
  const statements = [
    db
      .prepare("DELETE FROM usage_hourly WHERE hour<?")
      .bind(iso(addDays(deps.now(), -deps.config.sync.hourlyRetentionDays))),
    db
      .prepare(
        "DELETE FROM deliveries WHERE event_id IN (SELECT id FROM events WHERE created_at<?)",
      )
      .bind(cutoff),
    db.prepare("DELETE FROM events WHERE created_at<?").bind(cutoff),
    db
      .prepare(
        "DELETE FROM enforcement_actions WHERE created_at<? AND status NOT IN ('applied','restore_failed','planned')",
      )
      .bind(cutoff),
    db.prepare("DELETE FROM audit_log WHERE at<?").bind(cutoff),
  ];
  if (deps.config.retention.dailyDays) {
    const d = day(addDays(deps.now(), -deps.config.retention.dailyDays));
    for (const table of ["usage_daily", "cost_daily", "spend_daily", "fx_rates"])
      statements.push(db.prepare(`DELETE FROM ${table} WHERE day<?`).bind(d));
    statements.push(db.prepare("DELETE FROM budget_periods WHERE period_end<?").bind(d));
  }
  await db.batch(statements);
}
