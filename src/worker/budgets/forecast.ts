export function forecast(spent: number, elapsedHours: number, periodHours: number, kind: string) {
  return kind === "day" || elapsedHours <= 0 ? null : (spent / elapsedHours) * periodHours;
}
export function forecastTriggered(
  value: number | null,
  limit: number,
  elapsedHours: number,
  hours: number,
) {
  return value !== null && elapsedHours >= hours * 0.25 && value >= limit;
}
