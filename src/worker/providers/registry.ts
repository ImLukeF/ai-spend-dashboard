import type { Deps } from "../deps";
import { secret } from "../env";
import { anthropic } from "./anthropic/client";
import { openai } from "./openai/client";
import { openrouter } from "./openrouter/client";
import type { ProviderAdapter } from "./types";
export const PROVIDERS = [anthropic, openai, openrouter];

export function providerConfiguration(deps: Deps, provider: ProviderAdapter) {
  const enabled = deps.config.providers[provider.id].enabled;
  const configured = Boolean(secret(deps.env, provider.secretName));
  return {
    enabled,
    configured,
    status: !enabled ? "disabled" : configured ? "configured" : "not_configured",
  };
}
