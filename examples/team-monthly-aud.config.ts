import { defineConfig } from "../src/shared/config-schema";
export default defineConfig({
  display: {
    currency: "AUD",
    extraCurrencies: ["USD"],
    tax: { enabled: true, ratePercent: 10, label: "GST" },
  },
  tags: [
    {
      dimension: "team",
      rules: [{ value: "engineering", match: { workspaceName: "engineering*" } }],
    },
  ],
  channels: [
    { id: "slack", type: "slack", webhookUrlSecret: "SLACK_WEBHOOK_URL" },
    {
      id: "mail",
      type: "email",
      transport: "resend",
      apiKeySecret: "RESEND_API_KEY",
      fromSecret: "ALERT_EMAIL_FROM",
      toSecret: "ALERT_EMAIL_TO",
    },
  ],
  budgets: [
    {
      id: "team-monthly",
      name: "Engineering",
      period: "month",
      amount: 500,
      currency: "AUD",
      includeTax: true,
      scope: { tags: { team: ["engineering"] } },
      channels: ["slack", "mail"],
    },
  ],
});
