import { anthropic } from "./anthropic/client";
import { openai } from "./openai/client";
import { openrouter } from "./openrouter/client";
export const PROVIDERS = [anthropic, openai, openrouter];
