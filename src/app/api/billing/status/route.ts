// ============================================================
// GET /api/billing/status
//
// Current account's plan, subscription status, trial countdown,
// and usage vs plan limits. Any member can read this — the
// Settings → Billing tab renders it read-only for non-owners.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getUsageCounts } from "@/lib/billing/limits";
import { PLANS, isPlanId } from "@/lib/billing/plans";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: account, error } = await ctx.supabase
      .from("accounts")
      .select(
        "plan_id, subscription_status, trial_ends_at, current_period_end, razorpay_subscription_id",
      )
      .eq("id", ctx.accountId)
      .single();

    if (error || !account) {
      console.error("[GET /api/billing/status] account fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load billing status" },
        { status: 500 },
      );
    }

    const planId = isPlanId(account.plan_id) ? account.plan_id : "pro";
    const plan = PLANS[planId];
    const usage = await getUsageCounts(ctx.supabase, ctx.accountId);

    return NextResponse.json({
      plan: { id: plan.id, name: plan.name, limits: plan.limits },
      subscription_status: account.subscription_status,
      trial_ends_at: account.trial_ends_at,
      current_period_end: account.current_period_end,
      has_subscription: !!account.razorpay_subscription_id,
      usage,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
