import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class ToolRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ToolRequestError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedV4(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff")
    );
  }
  return true;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/**
 * Reject anything but public https endpoints. DNS is resolved and
 * every returned address checked, so a hostname pointing at an
 * internal address is refused.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  resolve: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ToolRequestError("invalid webhook URL", false);
  }
  if (url.protocol !== "https:") throw new ToolRequestError("webhook URL must use https", false);
  if (url.username || url.password) {
    throw new ToolRequestError("webhook URL must not contain credentials", false);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new ToolRequestError("webhook host is not allowed", false);
  }

  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname).catch(() => []);
  if (addresses.length === 0) throw new ToolRequestError("webhook host did not resolve", true);
  if (addresses.some(isPrivateAddress)) {
    throw new ToolRequestError("webhook host resolves to a private address", false);
  }
  return url;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export interface SignedPostOptions {
  secret: string;
  idempotencyKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
}

/**
 * POST JSON to a business-configured webhook. Signed with
 * `X-ForgeChat-Signature: t=<unix>,v1=<hmac>` over `${t}.${body}`.
 * Redirects are refused (they could bounce to an internal host).
 */
export async function postSignedJson<T = unknown>(
  rawUrl: string,
  payload: unknown,
  opts: SignedPostOptions,
): Promise<T> {
  const url = await assertSafeOutboundUrl(rawUrl, opts.resolve);
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "ForgeChat-Agent/1.0",
    "idempotency-key": opts.idempotencyKey,
  };
  if (opts.secret) {
    headers["x-forgechat-signature"] = `t=${timestamp},v1=${signPayload(opts.secret, timestamp, body)}`;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ToolRequestError(
      `webhook request failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }

  if (res.status >= 300 && res.status < 400) {
    throw new ToolRequestError("webhook redirects are not allowed", false);
  }
  if (!res.ok) {
    throw new ToolRequestError(`webhook returned ${res.status}`, res.status >= 500 || res.status === 429);
  }

  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ToolRequestError("webhook response too large", false);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ToolRequestError("webhook returned invalid JSON", false);
  }
}
