// ============================================================
// POST /api/billing/subscribe
//
// Owner-only. Creates a Razorpay subscription for the caller's
// account and returns the ids the client needs to open Razorpay
// Checkout. The subscription only becomes active once the
// customer completes the authorization payment in Checkout —
// that confirmation arrives asynchronously via
// POST /api/billing/webhook, which is the source of truth for
// `accounts.subscription_status`.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  getRazorpayClient,
  getRazorpayPlanId,
  totalCyclesFor,
} from "@/lib/billing/razorpay";
import {
  PURCHASABLE_PLAN_IDS,
  isPlanId,
  type BillingInterval,
  type PlanId,
} from "@/lib/billing/plans";

function isPurchasablePlanId(value: unknown): value is PlanId {
  return isPlanId(value) && (PURCHASABLE_PLAN_IDS as readonly string[]).includes(value);
}

function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "monthly" || value === "yearly";
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `billing:subscribe:${ctx.userId}`,
      RATE_LIMITS.billingAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { planId?: unknown; interval?: unknown }
      | null;

    if (!isPurchasablePlanId(body?.planId)) {
      return NextResponse.json(
        { error: "'planId' must be 'pro'" },
        { status: 400 },
      );
    }
    if (!isBillingInterval(body?.interval)) {
      return NextResponse.json(
        { error: "'interval' must be 'monthly' or 'yearly'" },
        { status: 400 },
      );
    }

    const planId = body!.planId as PlanId;
    const interval = body!.interval as BillingInterval;

    let razorpayPlanId: string;
    try {
      razorpayPlanId = getRazorpayPlanId(planId, interval);
    } catch (err) {
      console.error("[POST /api/billing/subscribe] plan mapping error:", err);
      return NextResponse.json(
        { error: "Billing is not configured for this plan yet" },
        { status: 500 },
      );
    }

    const razorpay = getRazorpayClient();
    const subscription = await razorpay.subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: totalCyclesFor(interval),
      customer_notify: true,
      notes: { account_id: ctx.accountId, plan_id: planId, interval },
    });

    // Stash the subscription id now so the webhook can find this
    // account by id alone (belt-and-braces alongside the `notes`
    // fallback in the webhook handler).
    const { error: updateError } = await ctx.supabase
      .from("accounts")
      .update({ razorpay_subscription_id: subscription.id })
      .eq("id", ctx.accountId);
    if (updateError) {
      console.error(
        "[POST /api/billing/subscribe] failed to save subscription id:",
        updateError,
      );
    }

    return NextResponse.json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      planId,
      interval,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
