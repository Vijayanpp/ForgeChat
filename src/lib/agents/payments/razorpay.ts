import type { RazorpayLookup } from "./decide";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

/**
 * Look up a payment by id. Returns null when Razorpay can't answer
 * (bad credentials, outage) so the caller falls back to human review
 * instead of trusting or rejecting the screenshot.
 */
export async function lookupRazorpayPayment(
  creds: RazorpayCredentials,
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RazorpayLookup> {
  try {
    const res = await fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404 || res.status === 400) return { found: false };
    if (!res.ok) {
      console.error("[agents/payments] razorpay lookup failed", res.status);
      return null;
    }
    const body = (await res.json()) as { status?: string; amount?: number; currency?: string; created_at?: number };
    return {
      found: true,
      status: String(body.status ?? "unknown"),
      amountPaise: Number(body.amount ?? 0),
      currency: String(body.currency ?? "INR"),
      createdAt: new Date(Number(body.created_at ?? 0) * 1000).toISOString(),
    };
  } catch (err) {
    console.error("[agents/payments] razorpay lookup error", err instanceof Error ? err.message : err);
    return null;
  }
}
