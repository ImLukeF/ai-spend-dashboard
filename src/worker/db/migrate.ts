import { MIGRATIONS } from "./migrations";

const ready = new WeakMap<D1Database, Promise<void>>();
export async function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db);
  if (!pending) {
    pending = apply(db).catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, pending);
  }
  return pending;
}
async function version(db: D1Database) {
  try {
    return (
      (await db.prepare("SELECT max(version) AS v FROM schema_migrations").first<number>("v")) ?? 0
    );
  } catch (e) {
    if (String(e).includes("no such table")) return 0;
    throw e;
  }
}
async function apply(db: D1Database) {
  for (const m of MIGRATIONS) {
    if ((await version(db)) >= m.version) continue;
    try {
      await db.batch([
        ...m.statements.map((s) => db.prepare(s)),
        db
          .prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)")
          .bind(m.version, m.name, new Date().toISOString()),
      ]);
    } catch (e) {
      if ((await version(db)) < m.version) throw e;
    }
  }
}
