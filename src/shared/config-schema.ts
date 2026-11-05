import { z } from "zod";
export const ProviderSchema = z.enum(["anthropic", "openai", "openrouter"]);
export type ProviderId = z.infer<typeof ProviderSchema>;
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
const secret = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const ids = z.array(z.string().min(1)).default([]);
const target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anthropic.deactivate_api_key"), apiKeyId: z.string().min(1) }),
  z.object({
    type: z.literal("anthropic.deactivate_workspace_keys"),
    workspaceId: z.string().min(1),
    maxKeys: z.number().int().min(1).max(100).default(20),
  }),
  z.object({ type: z.literal("openai.set_project_spend_limit"), projectId: z.string().min(1) }),
  z.object({ type: z.literal("openrouter.disable_key"), keyHash: z.string().min(1) }),
]);
const routing = {
  id,
  receives: z.array(z.enum(["budget", "enforcement", "sync"])).default(["budget", "enforcement"]),
};
export const ChannelSchema = z.discriminatedUnion("type", [
  z.object({
    ...routing,
    type: z.literal("webhook"),
    urlSecret: secret,
    signingSecretSecret: secret,
  }),
  z.object({ ...routing, type: z.literal("slack"), webhookUrlSecret: secret }),
  z.object({
    ...routing,
    type: z.literal("ntfy"),
    topicUrlSecret: secret,
    tokenSecret: secret.optional(),
    allowInsecureLocalhost: z.boolean().default(false),
  }),
  z.object({
    ...routing,
    type: z.literal("email"),
    transport: z.enum(["resend", "cloudflare"]).default("resend"),
    apiKeySecret: secret.optional(),
    fromSecret: secret,
    toSecret: secret,
  }),
]);
export const ScopeSchema = z.object({
  providers: z.array(ProviderSchema).default([]),
  workspaceIds: ids,
  apiKeyIds: ids,
  models: ids,
  tags: z.record(z.string(), z.array(z.string())).default({}),
});
export const BudgetSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  period: z.enum(["day", "week", "month"]),
  amount: z.number().finite().positive(),
  currency: currency.default("USD"),
  includeTax: z.boolean().default(false),
  scope: ScopeSchema.default({
    providers: [],
    workspaceIds: [],
    apiKeyIds: [],
    models: [],
    tags: {},
  }),
  thresholds: z.array(z.number().int().min(1).max(1000)).min(1).default([50, 80, 100]),
  forecast: z.boolean().default(true),
  notifyOnClose: z.boolean().default(false),
  channels: z.array(id).default([]),
  enforce: z
    .object({
      atPercent: z.number().min(1).default(100),
      restoreAtPeriodEnd: z.boolean().default(true),
      actions: z.array(target).min(1),
    })
    .nullable()
    .default(null),
});
export const ConfigSchema = z
  .object({
    auth: z.object({ mode: z.enum(["token", "access"]).default("token") }).prefault({}),
    runtime: z.object({ plan: z.enum(["free", "paid"]).default("free") }).prefault({}),
    publicUrl: z
      .union([
        z.literal(""),
        z.url().refine((u) => new URL(u).protocol === "https:", "publicUrl must use HTTPS"),
      ])
      .default(""),
    providers: z
      .object({
        anthropic: z.object({ enabled: z.boolean().default(true) }).prefault({}),
        openai: z.object({ enabled: z.boolean().default(true) }).prefault({}),
        openrouter: z.object({ enabled: z.boolean().default(false) }).prefault({}),
      })
      .prefault({}),
    display: z
      .object({
        currency: currency.default("USD"),
        extraCurrencies: z.array(currency).default([]),
        tax: z
          .object({
            enabled: z.boolean().default(false),
            ratePercent: z.number().min(0).max(100).default(10),
            label: z.string().min(1).max(32).default("GST"),
          })
          .prefault({}),
      })
      .prefault({}),
    fx: z
      .object({
        provider: z.enum(["ECB", "RBA"]).default("ECB"),
        markupPercent: z.number().min(0).max(20).default(0),
      })
      .prefault({}),
    sync: z
      .object({
        backfillDays: z.number().int().min(1).max(180).default(35),
        hourlyRetentionDays: z.number().int().min(1).max(400).default(14),
      })
      .prefault({}),
    pricing: z
      .object({
        overrides: z
          .array(
            z.object({
              provider: ProviderSchema,
              model: z.string(),
              metric: z.string(),
              usdPerMillion: z.number().finite().nonnegative(),
            }),
          )
          .default([]),
      })
      .prefault({}),
    tags: z
      .array(
        z.object({
          dimension: id,
          rules: z.array(
            z.object({
              value: z.string().min(1).max(120),
              match: z.object({
                provider: ProviderSchema.optional(),
                workspaceIds: z.array(z.string()).optional(),
                apiKeyIds: z.array(z.string()).optional(),
                workspaceName: z.string().optional(),
                apiKeyName: z.string().optional(),
              }),
            }),
          ),
        }),
      )
      .default([]),
    channels: z.array(ChannelSchema).default([]),
    budgets: z.array(BudgetSchema).default([]),
    enforcement: z
      .object({
        protectedKeyIds: ids,
        maxActionsPerTick: z.number().int().min(1).max(100).default(10),
        maxActionsPerDay: z.number().int().min(1).max(1000).default(50),
      })
      .prefault({}),
    retention: z
      .object({
        eventsDays: z.number().int().min(1).default(400),
        dailyDays: z.number().int().min(0).default(0),
      })
      .prefault({}),
  })
  .superRefine((c, ctx) => {
    for (const [name, values] of [
      ["budgets", c.budgets.map((b) => b.id)],
      ["channels", c.channels.map((b) => b.id)],
      ["tags", c.tags.map((b) => b.dimension)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: "custom", path: [name], message: "IDs must be unique" });
    for (const [i, b] of c.budgets.entries()) {
      if (b.thresholds.some((t, j) => j > 0 && t <= (b.thresholds[j - 1] ?? 0)))
        ctx.addIssue({
          code: "custom",
          path: ["budgets", i, "thresholds"],
          message: "Thresholds must be sorted and unique",
        });
      for (const dimension of Object.keys(b.scope.tags))
        if (!c.tags.some((t) => t.dimension === dimension))
          ctx.addIssue({
            code: "custom",
            path: ["budgets", i, "scope", "tags", dimension],
            message: "Unknown tag dimension",
          });
      for (const ch of b.channels)
        if (!c.channels.some((x) => x.id === ch))
          ctx.addIssue({
            code: "custom",
            path: ["budgets", i, "channels"],
            message: "Unknown channel",
          });
      for (const a of b.enforce?.actions ?? [])
        if (!c.providers[a.type.split(".")[0] as ProviderId].enabled)
          ctx.addIssue({
            code: "custom",
            path: ["budgets", i, "enforce"],
            message: "Enforcement provider must be enabled",
          });
    }
    for (const [i, ch] of c.channels.entries())
      if (ch.type === "email" && ch.transport === "resend" && !ch.apiKeySecret)
        ctx.addIssue({
          code: "custom",
          path: ["channels", i],
          message: "Resend requires apiKeySecret",
        });
  });
export type Config = z.infer<typeof ConfigSchema>;
export type Budget = Config["budgets"][number];
export type Channel = Config["channels"][number];
export type Action = NonNullable<Budget["enforce"]>["actions"][number];
export const defineConfig = (input: z.input<typeof ConfigSchema>) => input;
