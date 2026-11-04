import { z } from "zod";

const dim = z.string().nullish();
const count = z.number().int().nonnegative().optional().default(0);
export const usagePage = z.looseObject({
  data: z.array(
    z.looseObject({
      start_time: z.number().int(),
      end_time: z.number().int(),
      results: z.array(
        z.looseObject({
          input_tokens: count,
          input_cached_tokens: count,
          input_cache_write_tokens: count,
          input_uncached_tokens: z.number().int().nonnegative().optional(),
          output_tokens: count,
          num_model_requests: count,
          project_id: dim,
          api_key_id: dim,
          model: dim,
          service_tier: dim,
        }),
      ),
    }),
  ),
  has_more: z.boolean(),
  next_page: dim,
});
export const costPage = z.looseObject({
  data: z.array(
    z.looseObject({
      start_time: z.number().int(),
      end_time: z.number().int(),
      results: z.array(
        z.looseObject({
          amount: z.looseObject({
            value: z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)]),
            currency: z.string().refine((s) => s.toUpperCase() === "USD"),
          }),
          line_item: dim,
          project_id: dim,
          api_key_id: dim,
          quantity: z.number().finite().nullish(),
          quantity_unit: dim,
        }),
      ),
    }),
  ),
  has_more: z.boolean(),
  next_page: dim,
});
export const entityPage = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      name: z.string().default(""),
      status: z.string().optional(),
      created_at: z.number().nullish(),
      last_used_at: z.number().nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: dim,
});
export const spendLimit = z.looseObject({
  threshold_amount: z.number().int().min(1),
  currency: z.literal("USD"),
  interval: z.literal("month"),
  enforcement: z.looseObject({ status: z.enum(["enforcing", "inactive"]) }),
});
