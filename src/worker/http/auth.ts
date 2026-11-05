import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from "jose";
import type { Deps } from "../deps";
import { secret } from "../env";
import { boundedJson } from "../providers/http";
export interface Identity {
  authMode: "token" | "access" | "read-token";
  identity: string;
  canAdmin: boolean;
}
const encoder = new TextEncoder();
export function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unb64(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
export async function constantEqual(a: string, b: string) {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
async function sessionKey(token: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("ai-spend-dashboard"),
      info: encoder.encode("session-v1"),
    },
    key,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}
export async function createSession(token: string, now: Date) {
  const time = Math.floor(now.getTime() / 1000);
  const payload = b64(encoder.encode(JSON.stringify({ v: 1, iat: time, exp: time + 43200 })));
  return `${payload}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(token), encoder.encode(payload))))}`;
}
export async function validSession(value: string, token: string, now: Date) {
  try {
    const [payload = "", signature = "", extra] = value.split(".");
    if (extra || !payload || !signature || value.length > 1024) return false;
    const ok = await crypto.subtle.verify(
      "HMAC",
      await sessionKey(token),
      unb64(signature),
      encoder.encode(payload),
    );
    if (!ok) return false;
    const p = JSON.parse(new TextDecoder().decode(unb64(payload)));
    const t = now.getTime() / 1000;
    return (
      p.v === 1 &&
      Number.isInteger(p.iat) &&
      Number.isInteger(p.exp) &&
      p.iat <= t &&
      p.exp > t &&
      p.exp - p.iat === 43200
    );
  } catch {
    return false;
  }
}
export function cookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export function authConfigured(deps: Deps) {
  if (deps.config.auth.mode === "token") return secret(deps.env, "DASHBOARD_TOKEN").length >= 32;
  try {
    const u = new URL(secret(deps.env, "ACCESS_TEAM_DOMAIN"));
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".cloudflareaccess.com") &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      Boolean(secret(deps.env, "ACCESS_AUD"))
    );
  } catch {
    return false;
  }
}
const jwksCache = new Map<string, { value: JSONWebKeySet; until: number }>();
async function getJwks(deps: Deps, issuer: string, refresh = false) {
  const cached = jwksCache.get(issuer);
  if (!refresh && cached && cached.until > deps.now().getTime()) return cached.value;
  const res = await deps.fetch(`${issuer}/cdn-cgi/access/certs`, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("Access keys unavailable");
  const raw = await boundedJson(res, 100000);
  if (!raw || typeof raw !== "object" || !("keys" in raw) || !Array.isArray(raw.keys))
    throw new Error("Invalid Access keys");
  const value = raw as JSONWebKeySet;
  jwksCache.set(issuer, { value, until: deps.now().getTime() + 3600000 });
  return value;
}
function emails(deps: Deps, key: string) {
  return secret(deps.env, key)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
export async function authenticate(request: Request, deps: Deps): Promise<Identity | null> {
  const read = secret(deps.env, "READ_API_TOKEN");
  const bearer = request.headers.get("authorization") ?? "";
  if (
    read.length >= 32 &&
    bearer.startsWith("Bearer ") &&
    (await constantEqual(bearer.slice(7), read))
  )
    return { authMode: "read-token", identity: "read-token", canAdmin: false };
  if (deps.config.auth.mode === "token") {
    if (
      await validSession(
        cookie(request, "asd_session"),
        secret(deps.env, "DASHBOARD_TOKEN"),
        deps.now(),
      )
    )
      return { authMode: "token", identity: "token", canAdmin: true };
    return null;
  }
  const assertion =
    request.headers.get("cf-access-jwt-assertion") ?? cookie(request, "CF_Authorization");
  if (!assertion || assertion.length > 16384) return null;
  const issuer = secret(deps.env, "ACCESS_TEAM_DOMAIN").replace(/\/$/, "");
  const options = {
    issuer,
    audience: secret(deps.env, "ACCESS_AUD"),
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iss", "aud"],
    currentDate: deps.now(),
  };
  try {
    let result: Awaited<ReturnType<typeof jwtVerify>>;
    try {
      result = await jwtVerify(assertion, createLocalJWKSet(await getJwks(deps, issuer)), options);
    } catch (e) {
      if (!(e instanceof errors.JWKSNoMatchingKey)) throw e;
      result = await jwtVerify(
        assertion,
        createLocalJWKSet(await getJwks(deps, issuer, true)),
        options,
      );
    }
    const email =
      typeof result.payload.email === "string" ? result.payload.email.toLowerCase() : "";
    const allowed = emails(deps, "ALLOWED_EMAILS");
    if (allowed.length && !allowed.includes(email)) return null;
    const admins = emails(deps, "ADMIN_EMAILS");
    return {
      authMode: "access",
      identity: email || "access-service",
      canAdmin: Boolean(email) && (!admins.length || admins.includes(email)),
    };
  } catch {
    return null;
  }
}
export const SESSION_ATTRIBUTES = "HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200";
