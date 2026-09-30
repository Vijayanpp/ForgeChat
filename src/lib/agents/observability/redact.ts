const DATA_URL = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 9+ digits with optional separators: phone numbers, not prices or dates.
const PHONE = /(?<![\w-])\+?\d(?:[\s-]?\d){8,14}(?![\w-])/g;

const MAX_DEPTH = 12;

export function redactText(text: string): string {
  return text.replace(DATA_URL, "[image]").replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/** Deep-redact trace payloads before they leave the process. */
export function redactValue<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
