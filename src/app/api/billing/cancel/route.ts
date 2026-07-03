// ============================================================
// POST /api/billing/cancel
//
// Owner-only. Cancels the account's Razorpay subscription at the
// end of the current billing cycle (no immediate loss of access,
// no partial refund). The account keeps `subscription_status:
// 'active'` until the webhook confirms cancellation at the cycle
// boundary — see POST /api/billing/webhook.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getRazorpayClient } from "@/lib/billing/razorpay";

export async function POST() {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `billing:cancel:${ctx.userId}`,
      RATE_LIMITS.billingAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: account, error } = await ctx.supabase
      .from("accounts")
      .select("razorpay_subscription_id")
      .eq("id", ctx.accountId)
      .single();

    if (error || !account?.razorpay_subscription_id) {
      return NextResponse.json(
        { error: "No active subscription to cancel" },
        { status: 400 },
      );
    }

    const razorpay = getRazorpayClient();
    await razorpay.subscriptions.cancel(account.razorpay_subscription_id, true);

    return NextResponse.json({ success: true, cancels_at_period_end: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
