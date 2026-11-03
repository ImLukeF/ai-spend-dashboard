const patterns = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /sk-admin-[A-Za-z0-9_-]{6,}/g,
  /sk-proj-[A-Za-z0-9_-]{6,}/g,
  /sk-or-[A-Za-z0-9_-]{6,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /re_[A-Za-z0-9_]{10,}/g,
  /whsec_[A-Za-z0-9+/=]{10,}/g,
  /tk_[A-Za-z0-9]{10,}/g,
  /Bearer\s+\S+/gi,
  /hooks\.slack\.com\/services\/\S+/g,
  /https?:\/\/[^\s"']*ntfy[^\s"']*/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];
export function redact(input: unknown): string {
  let s = String(input instanceof Error ? input.message : input);
  for (const p of patterns) s = s.replace(p, "[redacted]");
  return s.slice(0, 300);
}
export function safeLog(value: unknown): void {
  console.log(JSON.stringify(value, (_k, v) => (typeof v === "string" ? redact(v) : v)));
}
