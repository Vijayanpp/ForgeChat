// ============================================================
// Razorpay server client — subscription creation, cancellation,
// and webhook signature verification.
//
// Server-only: reads RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
// from process.env. Never import this from a client component.
// ============================================================

import Razorpay from "razorpay";
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils";

import { PLANS, type BillingInterval, type PlanId } from "./plans";

let _client: Razorpay | null = null;

/** Throws if RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET aren't configured. */
export function getRazorpayClient(): Razorpay {
  if (_client) return _client;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error(
      "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET",
    );
  }
  _client = new Razorpay({ key_id, key_secret });
  return _client;
}

/** Looks up the Razorpay plan id (created in the Razorpay Dashboard) for
 *  an internal plan tier + billing interval, from the env vars declared
 *  in `PLANS[planId].razorpayEnv`. */
export function getRazorpayPlanId(planId: PlanId, interval: BillingInterval): string {
  const plan = PLANS[planId];
  if (!plan.razorpayEnv) {
    throw new Error(`Plan '${planId}' cannot be purchased directly`);
  }
  const envKey = plan.razorpayEnv[interval];
  const value = process.env[envKey];
  if (!value) {
    throw new Error(`Missing env var ${envKey} — create the plan in Razorpay and set it`);
  }
  return value;
}

/**
 * Razorpay subscriptions require a finite `total_count` of billing
 * cycles. We use a long horizon so the subscription auto-renews for
 * all practical purposes; cancellation is explicit (POST /api/billing/cancel)
 * rather than the count running out.
 */
const TOTAL_CYCLES: Record<BillingInterval, number> = {
  monthly: 120, // 10 years of monthly cycles
  yearly: 10, // 10 years of yearly cycles
};

export function totalCyclesFor(interval: BillingInterval): number {
  return TOTAL_CYCLES[interval];
}

/** Verifies the `X-Razorpay-Signature` header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[razorpay] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook");
    return false;
  }
  return validateWebhookSignature(rawBody, signature, secret);
}
