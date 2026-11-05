import type { Config } from "../shared/config-schema";
import type { Bindings } from "./env";
import { safeLog } from "./lib/redact";
export interface Deps {
  env: Bindings;
  config: Config;
  fetch: typeof fetch;
  now: () => Date;
  randomId: () => string;
  sleep: (ms: number) => Promise<void>;
  log: (entry: unknown) => void;
}
export function defaultDeps(env: Bindings, config: Config): Deps {
  return {
    env,
    config,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: safeLog,
  };
}
