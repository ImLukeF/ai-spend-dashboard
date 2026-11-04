export function validCsrf(request: Request) {
  const origin = request.headers.get("origin");
  return (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ===
      "application/json" &&
    request.headers.get("x-asd-csrf") === "1" &&
    (!origin || origin === new URL(request.url).origin)
  );
}
export async function requestJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request body");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16384) {
        await reader.cancel();
        throw new Error("Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new Error("Invalid JSON");
  }
}
