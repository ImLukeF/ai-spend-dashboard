export async function webhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
) {
  if (!secret.startsWith("whsec_")) throw new Error("Invalid webhook signing secret");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid webhook signing secret");
  }
  if (bytes.length < 16) throw new Error("Webhook signing secret too short");
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  return `v1,${btoa(String.fromCharCode(...signature))}`;
}
