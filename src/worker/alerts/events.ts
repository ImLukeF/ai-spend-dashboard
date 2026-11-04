import { iso } from "../../shared/periods";
import type { Deps } from "../deps";
export interface EventInput {
  type: string;
  severity: "info" | "warning" | "critical";
  dedupeKey: string;
  budgetId?: string;
  periodStart?: string;
  data: unknown;
  channels: string[];
}
export async function emit(deps: Deps, event: EventInput) {
  const id = deps.randomId();
  const time = iso(deps.now());
  const payload = JSON.stringify({ type: event.type, id, timestamp: time, data: event.data });
  const insert = deps.env.DB.prepare(
    "INSERT OR IGNORE INTO events(id,type,severity,dedupe_key,budget_id,period_start,payload,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    id,
    event.type,
    event.severity,
    event.dedupeKey,
    event.budgetId ?? null,
    event.periodStart ?? null,
    payload,
    time,
  );
  const deliveries = event.channels.map((channel) =>
    deps.env.DB.prepare(
      "INSERT OR IGNORE INTO deliveries(event_id,channel_id,status) SELECT id,?,'pending' FROM events WHERE dedupe_key=?",
    ).bind(channel, event.dedupeKey),
  );
  await deps.env.DB.batch([insert, ...deliveries]);
  return id;
}
