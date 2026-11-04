import type { Config, ProviderId } from "../../shared/config-schema";
import { usdToMicros } from "../../shared/money";
export interface Rate {
  provider: string;
  model: string;
  metric: string;
  micros_per_million: number;
}
export function estimate(
  provider: ProviderId,
  model: string,
  metric: string,
  quantity: number,
  config: Config,
  rates: Rate[],
) {
  const override = config.pricing.overrides.find(
    (r) => r.provider === provider && r.model === model && r.metric === metric,
  );
  const learned = rates.find(
    (r) => r.provider === provider && r.model === model && r.metric === metric,
  );
  const rate = override ? usdToMicros(override.usdPerMillion) : learned?.micros_per_million;
  if (rate === undefined)
    return {
      amountMicros: 0,
      unpricedTokens: metric.startsWith("input_") || metric === "output" ? quantity : 0,
    };
  return {
    amountMicros: Number((BigInt(Math.round(rate)) * BigInt(quantity) + 500000n) / 1000000n),
    unpricedTokens: 0,
  };
}
