import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { MIGRATIONS } from "../src/worker/db/migrations.ts";

const now = new Date();
const today = now.toISOString().slice(0, 10);
const sql = MIGRATIONS.flatMap((m) => [
  ...m.statements,
  `INSERT OR IGNORE INTO schema_migrations VALUES(${m.version},'${m.name}','${now.toISOString()}')`,
]);
for (let i = 0; i < 30; i++) {
  const date = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
  for (const [j, p] of ["anthropic", "openai", "openrouter"].entries()) {
    const amount = (j + 1) * 2300000 + (i % 7) * 170000;
    sql.push(
      `INSERT OR REPLACE INTO spend_daily VALUES('${p}','${date}','workspace_example','key_example_${j}','model-example-${j}','${p === "anthropic" ? "allocated" : "billed"}',${amount},0,'${now.toISOString()}')`,
    );
    sql.push(
      `INSERT OR REPLACE INTO usage_daily VALUES('${p}','${date}','workspace_example','key_example_${j}','model-example-${j}','','output',${1000 + i * 100},'${now.toISOString()}')`,
    );
    sql.push(
      `INSERT OR REPLACE INTO fx_rates VALUES('${date}','AUD',1.4,'synthetic demo data','${now.toISOString()}')`,
    );
  }
}
for (const [j, p] of ["anthropic", "openai", "openrouter"].entries()) {
  sql.push(
    `INSERT OR REPLACE INTO entities(provider,kind,id,name,workspace_id,status,meta,first_seen_at,last_seen_at) VALUES('${p}','workspace','workspace_example','Synthetic workspace','','active','{}','${now.toISOString()}','${now.toISOString()}')`,
  );
  sql.push(
    `INSERT OR REPLACE INTO entities(provider,kind,id,name,workspace_id,status,meta,first_seen_at,last_seen_at) VALUES('${p}','api_key','key_example_${j}','Synthetic bot ${j + 1}','workspace_example','active','{}','${now.toISOString()}','${now.toISOString()}')`,
  );
}
sql.push(
  `INSERT OR REPLACE INTO meta VALUES('data_version','1')`,
  `INSERT OR REPLACE INTO meta VALUES('synthetic_demo','true')`,
);
const file = ".cache/seed.sql";
writeFileSync(file, `${sql.join(";\n")};\n`);
try {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "burnrate", "--local", `--file=${file}`],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: ".cache/wrangler.log",
      },
    },
  );
  console.log(`Loaded synthetic demo data through ${today}. No provider credentials used.`);
} catch {
  console.error("Local seed failed; check local Wrangler/D1 availability.");
  process.exitCode = 1;
} finally {
  unlinkSync(file);
}
