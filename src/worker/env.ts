export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  EMAIL?: {
    send: (message: {
      to: string[];
      from: string;
      subject: string;
      text: string;
      html: string;
    }) => Promise<unknown>;
  };
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
