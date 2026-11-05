export function tagLabels(tags: unknown): string[] {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return [];
  return Object.entries(tags)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}=${value}`);
}

// What the Sync jobs table shows for one sync_state row.
export function jobStatus(
  job: { job?: unknown; provider?: unknown; cursor?: unknown; consecutive_failures?: unknown },
  providers: { provider?: unknown; status?: unknown }[],
): string {
  if (String(job.job ?? "").endsWith(".backfill") && job.cursor === "done") return "Complete";
  const failures = Number(job.consecutive_failures ?? 0);
  if (failures > 0) return `Failing (${failures})`;
  const provider = providers.find((p) => p.provider === job.provider);
  if (provider && provider.status !== "configured") return "Paused";
  return "OK";
}
