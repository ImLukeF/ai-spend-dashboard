import { sumMicros } from "../../shared/money";
export function allocate(amount: number, weights: { id: string; quantity: number }[]) {
  const merged = new Map<string, number>();
  for (const w of weights) merged.set(w.id, (merged.get(w.id) ?? 0) + w.quantity);
  const items = [...merged].filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = items.reduce((n, [, q]) => n + BigInt(q), 0n);
  if (total === 0n) return [{ id: "", amountMicros: amount }];
  const sign = amount < 0 ? -1 : 1;
  const positive = BigInt(Math.abs(amount));
  const rows = items.map(([id, q]) => ({
    id,
    amountMicros: Number((positive * BigInt(q)) / total),
    remainder: (positive * BigInt(q)) % total,
  }));
  let remaining = Math.abs(amount) - sumMicros(rows.map((r) => r.amountMicros));
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  );
  for (const r of ranked) {
    if (remaining <= 0) break;
    r.amountMicros++;
    remaining--;
  }
  return rows.map((r) => ({ id: r.id, amountMicros: r.amountMicros * sign }));
}
// UNVERIFIED: flex tiers map to standard cost; https://platform.claude.com/docs/en/manage-claude/usage-cost-api
export function tierClass(tier: string) {
  return tier === "batch" ? "batch" : tier.startsWith("priority") ? "priority" : "standard";
}
