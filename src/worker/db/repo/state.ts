export async function getMeta(db: D1Database, key: string) {
  return db.prepare("SELECT v FROM meta WHERE k=?").bind(key).first<string>("v");
}
export async function setMeta(db: D1Database, key: string, value: unknown) {
  return db
    .prepare(
      "INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE v IS NOT excluded.v",
    )
    .bind(key, typeof value === "string" ? value : JSON.stringify(value))
    .run();
}
export async function audit(
  db: D1Database,
  at: string,
  actor: string,
  action: string,
  detail: unknown = {},
) {
  await db
    .prepare("INSERT INTO audit_log(at,actor,action,detail) VALUES(?,?,?,?)")
    .bind(at, actor, action, JSON.stringify(detail))
    .run();
}
