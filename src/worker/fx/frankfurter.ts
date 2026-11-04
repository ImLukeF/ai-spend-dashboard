import { z } from "zod";
import { providerFetch } from "../providers/http";
import type { JobCtx } from "../providers/types";
export const ratesSchema = z.array(
  z.object({
    date: z.iso.date(),
    base: z.literal("USD"),
    quote: z.string().regex(/^[A-Z]{3}$/),
    rate: z.number().finite().positive(),
  }),
);
export async function pullFx(ctx: JobCtx, start: string, end: string) {
  const config = ctx.deps.config;
  const quotes = [
    ...new Set([
      config.display.currency,
      ...config.display.extraCurrencies,
      ...config.budgets.map((b) => b.currency),
    ]),
  ].filter((c) => c !== "USD");
  if (!quotes.length) return [];
  // UNVERIFIED: RBA AUD/USD redistribution terms; https://www.rba.gov.au/copyright/
  const params = new URLSearchParams({
    base: "USD",
    quotes: quotes.join(","),
    providers: config.fx.provider,
    from: start,
    to: end,
  });
  const result = await providerFetch(ctx, "fx", `/v2/rates?${params}`, ratesSchema);
  return (result ?? []).map((r) => ({
    day: r.date,
    quote: r.quote,
    rate: r.rate,
    source: `frankfurter:${config.fx.provider}`,
  }));
}
