import { defineConfig } from "../src/shared/config-schema";
export default defineConfig({
  tags: [
    { dimension: "agent", rules: [{ value: "support-bot", match: { apiKeyName: "support-*" } }] },
  ],
  channels: [{ id: "phone", type: "ntfy", topicUrlSecret: "NTFY_TOPIC_URL" }],
  budgets: [
    {
      id: "bot-daily",
      name: "Support bot",
      period: "day",
      amount: 10,
      scope: { apiKeyIds: ["apikey_EXAMPLE01"] },
      channels: ["phone"],
      enforce: {
        actions: [{ type: "anthropic.deactivate_api_key", apiKeyId: "apikey_EXAMPLE01" }],
      },
    },
  ],
});
