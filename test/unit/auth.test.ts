import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  authConfigured,
  authenticate,
  createSession,
  validSession,
} from "../../src/worker/http/auth";
import { deps, json, NOW } from "../helpers";

const token = "test-dashboard-token-0123456789abcdef0123";
it("signed sessions reject tampering, expiry and token rotation", async () => {
  const session = await createSession(token, NOW);
  expect(await validSession(session, token, NOW)).toBe(true);
  expect(await validSession(`${session}x`, token, NOW)).toBe(false);
  expect(await validSession(session, `${token}rotated`, NOW)).toBe(false);
  expect(await validSession(session, token, new Date(NOW.getTime() + 43200000))).toBe(false);
});
it("fails closed on short tokens, unsafe Access domains and absent audience", () => {
  expect(authConfigured(deps({}, { DASHBOARD_TOKEN: "short" }))).toBe(false);
  expect(
    authConfigured(
      deps(
        { auth: { mode: "access" } },
        { ACCESS_TEAM_DOMAIN: "https://example.com", ACCESS_AUD: "example" },
      ),
    ),
  ).toBe(false);
});
describe("Access verifies actual cryptographic JWTs against fake JWKS", () => {
  it("verifies claims and email allowlists and refreshes unknown kid once", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "example-kid-1", alg: "RS256" };
    const issuer = "https://test-team.cloudflareaccess.com";
    const c = deps(
      { auth: { mode: "access" } },
      {
        ACCESS_TEAM_DOMAIN: issuer,
        ACCESS_AUD: "example-aud",
        ALLOWED_EMAILS: "viewer@example.com",
        ADMIN_EMAILS: "admin@example.com",
      },
    );
    let calls = 0;
    c.fetch = async () => {
      calls++;
      return json({ keys: [jwk] });
    };
    const sign = async (
      extra: Record<string, unknown> = {},
      aud = "example-aud",
      iss = issuer,
      exp = NOW.getTime() / 1000 + 600,
    ) =>
      new SignJWT({ email: "viewer@example.com", ...extra })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuer(iss)
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(privateKey);
    const request = (jwt: string) =>
      new Request("https://example.com/api/v1/me", { headers: { "Cf-Access-Jwt-Assertion": jwt } });
    expect(await authenticate(request(await sign()), c)).toMatchObject({
      identity: "viewer@example.com",
      canAdmin: false,
    });
    expect(calls).toBe(1);
    for (const jwt of [
      await sign({}, "wrong"),
      await sign({}, "example-aud", "https://other.cloudflareaccess.com"),
      await sign({}, "example-aud", issuer, NOW.getTime() / 1000 - 1),
      await sign({ email: "denied@example.com" }),
    ])
      expect(await authenticate(request(jwt), c)).toBeNull();
    jwk.kid = "example-kid-2";
    expect(await authenticate(request(await sign()), c)).toBeTruthy();
    expect(calls).toBe(2);
    const badAlg = await new SignJWT({ email: "viewer@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience("example-aud")
      .setExpirationTime(NOW.getTime() / 1000 + 600)
      .sign(new TextEncoder().encode(token));
    expect(await authenticate(request(badAlg), c)).toBeNull();
    c.env.ALLOWED_EMAILS = "";
    const service = await sign({ email: undefined });
    expect(await authenticate(request(service), c)).toMatchObject({
      identity: "access-service",
      canAdmin: false,
    });
  });
});
