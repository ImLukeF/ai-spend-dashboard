import { iso } from "../../../shared/periods";
import type { Deps } from "../../deps";
import { type StoredAction, transition } from "../../enforcement/execute";
import type { EntityRow } from "../../providers/types";
export async function upsertEntities(deps: Deps, rows: EntityRow[]) {
  if (!rows.length) return;
  const now = iso(deps.now());
  const list = rows.map((r) => ({
    provider: r.provider,
    kind: r.kind,
    id: r.id,
    name: r.name,
    workspace_id: r.workspaceId,
    status: r.status,
    created_at: r.createdAt ?? null,
    last_used_at: r.lastUsedAt ?? null,
    meta: JSON.stringify(r.meta ?? {}),
    first_seen_at: now,
    last_seen_at: now,
  }));
  const columns = [
    "provider",
    "kind",
    "id",
    "name",
    "workspace_id",
    "status",
    "created_at",
    "last_used_at",
    "meta",
    "first_seen_at",
    "last_seen_at",
  ];
  const statements = [];
  for (let i = 0; i < list.length; i += 100)
    statements.push(
      deps.env.DB.prepare(
        `INSERT INTO entities (${columns.join(",")}) SELECT ${columns.map((c) => `json_extract(value,'$.${c}')`).join(",")} FROM json_each(?) WHERE true ON CONFLICT(provider,kind,id) DO UPDATE SET ${columns
          .slice(3)
          .filter((c) => c !== "first_seen_at")
          .map((c) => `${c}=excluded.${c}`)
          .join(",")}`,
      ).bind(JSON.stringify(list.slice(i, i + 100))),
    );
  await deps.env.DB.batch(statements);
  const actions = await deps.env.DB.prepare(
    "SELECT * FROM enforcement_actions WHERE status='applied' AND provider!='openai'",
  ).all<StoredAction>();
  for (const a of actions.results) {
    const entity = rows.find((r) => r.provider === a.provider && r.id === a.target_id);
    if (entity?.status === "active") await transition(deps, a, "overridden", "human_reenabled");
  }
}
