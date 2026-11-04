import { iso } from "../../../shared/periods";
export const FACTS = {
  usage_hourly: {
    keys: ["provider", "hour", "workspace_id", "api_key_id", "model", "service_tier", "metric"],
    values: ["quantity"],
  },
  usage_daily: {
    keys: ["provider", "day", "workspace_id", "api_key_id", "model", "service_tier", "metric"],
    values: ["quantity"],
  },
  cost_daily: {
    keys: [
      "provider",
      "day",
      "workspace_id",
      "api_key_id",
      "model",
      "service_tier",
      "metric",
      "line_item",
    ],
    values: ["amount_micros", "quantity"],
  },
  spend_daily: {
    keys: ["provider", "day", "workspace_id", "api_key_id", "model", "basis"],
    values: ["amount_micros", "unpriced_tokens"],
  },
} as const;
export type FactTable = keyof typeof FACTS;
export type Fact = Record<string, string | number | null>;
// Stage arbitrarily paged snapshots in bounded JSON chunks. Delete only after every page succeeds.
export async function replaceWindow(
  db: D1Database,
  table: FactTable,
  provider: string,
  start: string,
  end: string,
  rows: Fact[],
  now: Date,
): Promise<number> {
  const { keys, values } = FACTS[table];
  const columns = [...keys, ...values, "updated_at"];
  const key = table === "usage_hourly" ? "hour" : "day";
  const merged = new Map<string, Fact>();
  for (const row of rows) {
    const id = JSON.stringify(keys.map((k) => row[k]));
    const prev = merged.get(id);
    if (prev) {
      for (const v of values)
        if (typeof row[v] === "number") prev[v] = Number(prev[v] ?? 0) + Number(row[v]);
    } else merged.set(id, { ...row });
  }
  const normalized = [...merged.values()].map((r) => ({ ...r, updated_at: iso(now) }));
  const payload = JSON.stringify(normalized);
  // Bind data, never interpolate provider values. A JSON parameter is not part of the SQL text limit.
  // Limit memory and D1 value size to 90KB per statement; use temporary staging rows for large windows.
  const chunks: (typeof normalized)[] = [];
  let chunk: typeof normalized = [];
  let size = 2;
  for (const row of normalized) {
    const n = JSON.stringify(row).length + 1;
    if (n > 90000) throw new Error("Fact row too large");
    if (size + n > 90000) {
      chunks.push(chunk);
      chunk = [];
      size = 2;
    }
    chunk.push(row);
    size += n;
  }
  chunks.push(chunk);
  if (chunks.length > 1) {
    // A single batch is atomic; existing rows survive any staging/upsert failure.
    const token = crypto.randomUUID();
    await db.exec(
      "CREATE TABLE IF NOT EXISTS snapshot_stage (token TEXT NOT NULL, row TEXT NOT NULL)",
    );
    try {
      const statements = chunks.map((c) =>
        db
          .prepare("INSERT INTO snapshot_stage(token,row) SELECT ?1,value FROM json_each(?2)")
          .bind(token, JSON.stringify(c)),
      );
      const source = "SELECT row AS value FROM snapshot_stage WHERE token = ?1";
      statements.push(db.prepare(upsert(table, columns, keys, values, source)).bind(token));
      statements.push(
        db.prepare(remove(table, key, keys, source)).bind(token, provider, start, end),
      );
      const result = await db.batch(statements);
      return result.slice(-2).reduce((n, r) => n + r.meta.changes, 0);
    } finally {
      await db.prepare("DELETE FROM snapshot_stage WHERE token=?").bind(token).run();
    }
  }
  const result = await db.batch([
    db
      .prepare(upsert(table, columns, keys, values, "SELECT value FROM json_each(?1)"))
      .bind(payload),
    db
      .prepare(remove(table, key, keys, "SELECT value FROM json_each(?1)"))
      .bind(payload, provider, start, end),
  ]);
  return result.reduce((n, r) => n + r.meta.changes, 0);
}
function upsert(
  table: string,
  columns: readonly string[],
  keys: readonly string[],
  values: readonly string[],
  source: string,
) {
  return `INSERT INTO ${table} (${columns.join(",")}) SELECT ${columns.map((c) => `json_extract(value,'$.${c}')`).join(",")} FROM (${source}) WHERE true ON CONFLICT (${keys.join(",")}) DO UPDATE SET ${[...values, "updated_at"].map((c) => `${c}=excluded.${c}`).join(",")} WHERE ${values.map((c) => `${table}.${c} IS NOT excluded.${c}`).join(" OR ")}`;
}
function remove(table: string, key: string, keys: readonly string[], source: string) {
  return `DELETE FROM ${table} WHERE provider=?2 AND ${key}>=?3 AND ${key}<?4 AND NOT EXISTS (SELECT 1 FROM (${source}) s WHERE ${keys.map((k) => `json_extract(s.value,'$.${k}') IS ${table}.${k}`).join(" AND ")})`;
}
