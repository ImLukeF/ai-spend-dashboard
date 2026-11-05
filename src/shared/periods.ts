export const iso = (date: Date) => date.toISOString().replace(".000Z", "Z");
export const day = (date: Date) => iso(date).slice(0, 10);
export const addDays = (date: Date, n: number) => new Date(date.getTime() + n * 86400000);
export function period(now: Date, kind: "day" | "week" | "month") {
  const start = new Date(`${day(now)}T00:00:00Z`);
  if (kind === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (kind === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (kind === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (kind === "week" ? 7 : 1));
  return {
    start: iso(start),
    end: iso(end),
    elapsedHours: Math.max(0, (now.getTime() - start.getTime()) / 3600000),
    hours: (end.getTime() - start.getTime()) / 3600000,
  };
}
