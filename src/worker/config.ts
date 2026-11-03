import input from "../../spend.config";
import { ConfigSchema } from "../shared/config-schema";
import { hash } from "./lib/hash";
export async function loadConfig(value: unknown = input) {
  const result = ConfigSchema.safeParse(value);
  if (!result.success)
    return {
      ok: false as const,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  return { ok: true as const, config: result.data, hash: await hash(result.data) };
}
