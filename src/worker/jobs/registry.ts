import type { ProviderAdapter } from "../providers/types";
export function jobsFor(p: ProviderAdapter) {
  return [
    ...(p.pullUsageHourly ? [{ kind: "usage_hourly", minutes: 15 }] : []),
    ...(p.pullUsageDaily ? [{ kind: "usage_daily", minutes: 60 }] : []),
    { kind: "cost_daily", minutes: 60 },
    { kind: "entities", minutes: 1440 },
    { kind: "backfill", minutes: 15 },
  ].map((j) => ({ ...j, id: `${p.id}.${j.kind}`, adapter: p }));
}
