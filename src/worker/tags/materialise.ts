import type { ProviderId } from "../../shared/config-schema";
import { getMeta, setMeta } from "../db/repo/state";
import type { Deps } from "../deps";
import { hash } from "../lib/hash";
import { matchTags } from "./match";
export async function materialise(deps: Deps) {
  const db = deps.env.DB;
  const result = await db
    .prepare(
      `WITH combos AS (SELECT provider,workspace_id,api_key_id FROM spend_daily UNION SELECT provider,workspace_id,CASE WHEN kind='api_key' THEN id ELSE '' END FROM entities) SELECT c.*,COALESCE(k.name,'') apiKeyName,COALESCE(w.name,'') workspaceName FROM combos c LEFT JOIN entities k ON k.provider=c.provider AND k.kind='api_key' AND k.id=c.api_key_id LEFT JOIN entities w ON w.provider=c.provider AND w.kind='workspace' AND w.id=c.workspace_id`,
    )
    .all<{
      provider: ProviderId;
      workspace_id: string;
      api_key_id: string;
      apiKeyName: string;
      workspaceName: string;
    }>();
  const signature = await hash({ tags: deps.config.tags, entities: result.results });
  if (signature === (await getMeta(db, "tags_hash"))) return 0;
  const rows = result.results.flatMap((r) =>
    Object.entries(
      matchTags(deps.config, { ...r, workspaceId: r.workspace_id, apiKeyId: r.api_key_id }),
    ).map(([dimension, value]) => ({ ...r, dimension, value })),
  );
  const statements = [db.prepare("DELETE FROM entity_tags")];
  for (let i = 0; i < rows.length; i += 250)
    statements.push(
      db
        .prepare(
          `INSERT INTO entity_tags(provider,workspace_id,api_key_id,dimension,value) SELECT json_extract(value,'$.provider'),json_extract(value,'$.workspace_id'),json_extract(value,'$.api_key_id'),json_extract(value,'$.dimension'),json_extract(value,'$.value') FROM json_each(?)`,
        )
        .bind(JSON.stringify(rows.slice(i, i + 250))),
    );
  await db.batch(statements);
  await setMeta(db, "tags_hash", signature);
  return Math.max(1, rows.length);
}
