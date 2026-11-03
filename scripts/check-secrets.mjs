import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const allow = readFileSync(new URL("./check-secrets.allow", import.meta.url), "utf8")
  .split("\n")
  .filter((x) => x && !x.startsWith("#"));
const patterns = [
  /(?:sk-(?:ant-|admin-|proj-|or-)[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_]{10,}|whsec_[A-Za-z0-9+/=]{10,}|tk_[A-Za-z0-9]{10,})/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /[A-Za-z0-9-]+\.workers\.dev/g,
];
let failed = false;
for (const file of files) {
  if (allow.includes(file)) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const matches = patterns.flatMap((p) => [...line.matchAll(p)].map((m) => m[0]));
    if (/wrangler.*\.jsonc$/.test(file))
      matches.push(...(line.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi) ?? []));
    for (const value of matches) {
      if (
        /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/.test(
          value,
        ) ||
        /@example\.(com|org|net)$/.test(value) ||
        value === "placeholder.workers.dev"
      )
        continue;
      console.error(`${file}:${i + 1}: forbidden sensitive-data pattern`);
      failed = true;
    }
  });
}
if (failed) process.exit(1);
console.log(`Secret scan passed (${files.length} tracked files).`);
