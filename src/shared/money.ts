export class SchemaDriftError extends Error {
  constructor(endpoint: string, field: string) {
    super(`SchemaDriftError: ${endpoint}: ${field}`);
    this.name = "SchemaDriftError";
  }
}
function decimal(value: string, places: number): number {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new SchemaDriftError("money", "invalid decimal");
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  let n =
    BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.slice(0, places).padEnd(places, "0"));
  if (Number(fraction[places] ?? "0") >= 5) n += 1n;
  if (negative) n = -n;
  const result = Number(n);
  if (!Number.isSafeInteger(result)) throw new SchemaDriftError("money", "unsafe amount");
  return result;
}
export const centsDecimalStringToMicros = (s: string) => decimal(s, 4);
export function usdToMicros(v: number | string): number {
  if (typeof v === "string") return decimal(v, 6);
  const n = Math.round(v * 1e6);
  if (!Number.isFinite(v) || !Number.isSafeInteger(n))
    throw new SchemaDriftError("money", "non-finite or unsafe amount");
  return n;
}
export function sumMicros(values: Iterable<number>): number {
  let n = 0;
  for (const value of values) {
    n += value;
    if (!Number.isSafeInteger(n)) throw new Error("Money overflow");
  }
  return n;
}
