import type { z } from "zod";
import { SchemaDriftError } from "../../shared/money";
import { redact } from "../lib/redact";
import type { JobCtx } from "./types";
export const origins = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai",
  fx: "https://api.frankfurter.dev",
} as const;
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Provider HTTP ${status}: ${path}`);
  }
}
export async function boundedJson(response: Response, limit = 10 * 1024 * 1024): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Response exceeds size cap");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Response exceeds size cap");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new SchemaDriftError("response", "invalid JSON");
  }
}
export async function providerFetch<T>(
  ctx: JobCtx,
  provider: keyof typeof origins,
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  allow404 = false,
): Promise<T | null> {
  const url = new URL(path, origins[provider]);
  if (url.origin !== origins[provider] || url.protocol !== "https:" || url.username || url.password)
    throw new Error("Provider host refused");
  for (let attempt = 0; attempt < 3; attempt++) {
    ctx.budget.request();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const headers = new Headers(init.headers);
      headers.set(
        "User-Agent",
        "ai-spend-dashboard/0.1.0 (+https://github.com/ImLukeF/ai-spend-dashboard)",
      );
      headers.set("Accept", "application/json");
      if (init.body) headers.set("Content-Type", "application/json");
      if (provider === "anthropic") {
        headers.set("x-api-key", ctx.secret);
        headers.set("anthropic-version", "2023-06-01");
      } else if (provider !== "fx") headers.set("Authorization", `Bearer ${ctx.secret}`);
      const response = await ctx.deps.fetch(url, {
        ...init,
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      if (allow404 && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retry = response.headers.get("retry-after");
          const seconds = retry ? Number(retry) : Number.NaN;
          const delay = retry
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retry) - ctx.deps.now().getTime()
            : 2000 * 2 ** attempt + Math.random() * 200;
          await ctx.deps.sleep(Math.max(0, Math.min(30000, Number.isFinite(delay) ? delay : 2000)));
          continue;
        }
        throw new ProviderError(response.status, url.pathname);
      }
      const raw = await boundedJson(response);
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new SchemaDriftError(
          url.pathname,
          parsed.error.issues.map((i) => i.path.join(".")).join(", "),
        );
      return parsed.data;
    } catch (e) {
      if (e instanceof ProviderError || e instanceof SchemaDriftError) throw e;
      throw new Error(redact(e));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Retry exhausted");
}
