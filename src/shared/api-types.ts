import { z } from "zod";
export const BasisMixSchema = z.object({
  billed: z.number(),
  allocated: z.number(),
  estimated: z.number(),
});
export const SpendRowSchema = z.object({
  day: z.string(),
  group: z.string(),
  amount: z.number(),
  amountMicros: z.number().int(),
  basisMix: BasisMixSchema,
  unpricedTokens: z.number().int(),
  tokens: z.number(),
  requests: z.number(),
});
export const SpendResponseSchema = z.object({
  rows: z.array(SpendRowSchema),
  currency: z.string(),
  taxIncluded: z.boolean(),
  warnings: z.array(z.string()),
});
export type SpendRow = z.infer<typeof SpendRowSchema>;
export const BudgetViewSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  period: z.string(),
  spent: z.number(),
  limit: z.number(),
  currency: z.string(),
  percent: z.number().nullable(),
  status: z.string(),
  forecast: z.number().nullable(),
});
export const BudgetsResponseSchema = z.object({ budgets: z.array(BudgetViewSchema) });
export const SummaryResponseSchema = z.looseObject({
  generatedAt: z.string(),
  currency: z.string(),
  taxIncluded: z.boolean(),
  totals: z.object({
    today: z.number(),
    yesterday: z.number(),
    weekToDate: z.number(),
    monthToDate: z.number(),
    monthForecast: z.number().nullable(),
  }),
  byProvider: z.array(
    z.looseObject({ provider: z.string(), monthToDate: z.number(), basisMix: BasisMixSchema }),
  ),
  budgets: z.array(BudgetViewSchema),
  freshness: z.array(z.looseObject({ provider: z.string(), stale: z.boolean() })),
  unpricedTokens: z.number(),
  warnings: z.array(z.string()),
});
export const UsageResponseSchema = z.object({
  rows: z.array(z.object({ bucket: z.string(), group: z.string(), quantity: z.number() })),
});
