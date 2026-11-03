// UNVERIFIED: Deploy UI blank optional-secret handling; empty and dash both mean unset. https://developers.cloudflare.com/workers/platform/deploy-buttons/
export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  EMAIL?: SendEmail;
  [key: string]: unknown;
}
export function secret(env: Bindings, name: string): string {
  const v = env[name];
  return typeof v === "string" && v.trim() && v.trim() !== "-" ? v.trim() : "";
}
export const providerSecrets = {
  anthropic: "ANTHROPIC_ADMIN_KEY",
  openai: "OPENAI_ADMIN_KEY",
  openrouter: "OPENROUTER_MANAGEMENT_KEY",
} as const;
