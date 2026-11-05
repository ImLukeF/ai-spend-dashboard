export interface AlertEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}
export function formatAlert(event: AlertEvent) {
  const d = event.data;
  const budget = d.budget as { name?: string } | undefined;
  const money = (n: unknown) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: typeof d.currency === "string" ? d.currency : "USD",
    }).format(Number(n ?? 0));
  const title = event.type.startsWith("enforcement.")
    ? `${event.type === "enforcement.dry_run" ? "DRY RUN — would act" : event.type} · target ${String(d.targetId ?? "").slice(0, 4)}…`
    : `[Burnrate] ${budget?.name ?? event.type}`;
  const text = budget
    ? `${title} reached ${Number(d.percent ?? 0).toFixed(0)}% — ${money(d.spent)} of ${money(d.limit)} (${d.taxIncluded ? "incl. tax" : "excl. tax"}) · UTC${d.forecast != null ? ` · forecast ${money(d.forecast)}` : ""} · data as of ${String(d.dataAsOf ?? event.timestamp)}`
    : `${title} · ${event.type === "test" ? "Test alert. This channel works." : [d.provider, d.reason ?? d.error].filter(Boolean).join(": ")} · ${event.timestamp}`;
  const escapeHtml = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
    );
  return {
    title: title.slice(0, 100),
    text: text.slice(0, 2000),
    html: `<p>${escapeHtml(text.slice(0, 2000))}</p>`,
    priority:
      event.type === "enforcement.applied" || event.type === "enforcement.failed"
        ? 5
        : event.type === "budget.forecast" || Number(d.percent) >= 100
          ? 4
          : 3,
  };
}
