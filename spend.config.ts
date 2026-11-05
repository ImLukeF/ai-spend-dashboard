import { defineConfig } from "./src/shared/config-schema";
export default defineConfig({
  auth: { mode: "token" },
  runtime: { plan: "free" },
  providers: {
    anthropic: { enabled: true },
    openai: { enabled: true },
    openrouter: { enabled: false },
  },
  display: { currency: "USD", extraCurrencies: ["EUR", "GBP", "AUD", "CAD", "JPY", "INR"] },
  channels: [],
  budgets: [],
});
