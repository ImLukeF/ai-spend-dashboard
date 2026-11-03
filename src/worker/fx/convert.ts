export interface FxRate {
  day: string;
  quote: string;
  rate: number;
  source: string;
}
export function rateFor(rates: FxRate[], day: string, currency: string) {
  if (currency === "USD") return { day, quote: "USD", rate: 1, source: "USD" };
  const matches = rates
    .filter((r) => r.quote === currency)
    .sort((a, b) => a.day.localeCompare(b.day));
  return matches.filter((r) => r.day <= day).at(-1) ?? matches[0] ?? null;
}
export function convert(
  micros: number,
  day: string,
  currency: string,
  rates: FxRate[],
  markup = 0,
  tax = 0,
) {
  const rate = rateFor(rates, day, currency);
  return {
    amount:
      (micros / 1e6) *
      (rate?.rate ?? 1) *
      (1 + (currency === "USD" ? 0 : markup) / 100) *
      (1 + tax / 100),
    missing: !rate,
    currency: rate ? currency : "USD",
    rate,
  };
}
