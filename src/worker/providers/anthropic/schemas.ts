import { z } from "zod";

const count = z.number().int().nonnegative().optional().default(0);
const dim = z.string().nullish();
export const usageResult = z.looseObject({
  uncached_input_tokens: count,
  cache_read_input_tokens: count,
  output_tokens: count,
  cache_creation: z
    .looseObject({ ephemeral_5m_input_tokens: count, ephemeral_1h_input_tokens: count })
    .nullish(),
  server_tool_use: z.looseObject({ web_search_requests: count }).nullish(),
  api_key_id: dim,
  workspace_id: dim,
  model: dim,
  service_tier: dim,
});
export const usagePage = z.looseObject({
  data: z.array(
    z.looseObject({
      starting_at: z.iso.datetime(),
      ending_at: z.iso.datetime(),
      results: z.array(usageResult),
    }),
  ),
  has_more: z.boolean(),
  next_page: dim,
});
export const costPage = z.looseObject({
  data: z.array(
    z.looseObject({
      starting_at: z.iso.datetime(),
      ending_at: z.iso.datetime(),
      results: z.array(
        z.looseObject({
          amount: z.string().regex(/^-?\d+(\.\d+)?$/),
          currency: z.literal("USD"),
          workspace_id: dim,
          model: dim,
          service_tier: dim,
          token_type: dim,
          cost_type: dim,
          description: dim,
        }),
      ),
    }),
  ),
  has_more: z.boolean(),
  next_page: dim,
});
export const entity = z.looseObject({
  id: z.string().min(1),
  name: z.string().default(""),
  status: z.string().optional(),
  workspace_id: dim,
  scope: z.looseObject({ workspace_id: dim }).nullish(),
  created_at: dim,
  archived_at: dim,
});
export const entityPage = z.looseObject({
  data: z.array(entity),
  has_more: z.boolean(),
  last_id: dim,
});
