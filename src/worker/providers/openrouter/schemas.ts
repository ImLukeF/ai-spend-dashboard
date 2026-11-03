import { z } from "zod";

const numeric = z
  .union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)])
  .transform(Number);
export const keySchema = z.looseObject({
  hash: z.string().min(1),
  name: z.string().nullish(),
  label: z.string().nullish(),
  disabled: z.boolean(),
  workspace_id: z.string().nullish(),
  created_at: z.string().nullish(),
  last_used_at: z.string().nullish(),
  limit: numeric.nullish(),
  limit_remaining: numeric.nullish(),
  limit_reset: z.string().nullish(),
  include_byok_in_limit: z.boolean().optional(),
  usage: numeric.optional(),
  usage_daily: numeric.optional(),
  usage_weekly: numeric.optional(),
  usage_monthly: numeric.optional(),
});
export const keysPage = z.looseObject({ data: z.array(keySchema) });
export const analytics = z.looseObject({
  data: z.looseObject({
    data: z.array(
      z.looseObject({
        date__day: z.string().optional(),
        created_at__day: z.string().optional(),
        api_key_id: z.string().nullish(),
        model: z.string().nullish(),
        total_usage: numeric,
        request_count: numeric,
        tokens_prompt: numeric,
        tokens_completion: numeric,
      }),
    ),
    metadata: z.looseObject({ truncated: z.boolean(), row_count: z.number().optional() }),
  }),
});
