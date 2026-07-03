// ============================================================
// POST /api/billing/webhook
//
// Public endpoint (no Supabase auth) — configure this URL in the
// Razorpay Dashboard under Settings → Webhooks. Every request is
// verified against RAZORPAY_WEBHOOK_SECRET via the X-Razorpay-
// Signature header before anything else runs.
//
// This is the ONLY place `accounts.subscription_status` /
// `plan_id` change after checkout — /api/billing/subscribe just
// creates the subscription; the customer still has to authorize
// it in the Razorpay Checkout modal, and Razorpay confirms that
// asynchronously here.
//
// Idempotency: Razorpay retries undelivered webhooks, so every
// event is recorded in `billing_events` keyed by the
// X-Razorpay-Event-Id header before we act on a duplicate twice.
// ============================================================

import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/billing/razorpay";
import { supabaseAdmin } from "@/lib/billing/admin-client";
import { isPlanId, type SubscriptionStatus } from "@/lib/billing/plans";

interface RazorpaySubscriptionEntity {
  id: string;
  customer_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  notes?: Record<string, string>;
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
  };
}

function toIso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number"
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}

/** Maps a subscription lifecycle event to our internal status. Events
 *  we don't recognise (payment.*, refund.*, etc.) return null and are
 *  logged to `billing_events` without mutating the account. */
function mapEventToStatus(event: string): SubscriptionStatus | null {
  switch (event) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.resumed":
      return "active";
    case "subscription.pending":
    case "subscription.halted":
      return "past_due";
    case "subscription.cancelled":
    case "subscription.completed":
      return "canceled";
    default:
      return null;
  }
}

export async function POST(request: Request) {
  // Signature verification needs the exact raw bytes Razorpay signed —
  // `request.json()` would re-serialize and break the HMAC check.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const eventId = request.headers.get("x-razorpay-event-id");

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    console.error("[POST /api/billing/webhook] invalid or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body.event;
  if (!event) {
    return NextResponse.json({ received: true });
  }

  const admin = supabaseAdmin();

  if (eventId) {
    const { data: existing } = await admin
      .from("billing_events")
      .select("id")
      .eq("razorpay_event_id", eventId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  const subscriptionEntity = body.payload?.subscription?.entity;
  let accountId: string | null = null;

  if (subscriptionEntity) {
    const { data: matchedAccount } = await admin
      .from("accounts")
      .select("id")
      .eq("razorpay_subscription_id", subscriptionEntity.id)
      .maybeSingle();
    // Fall back to the account_id we stashed in `notes` at subscribe
    // time, in case the subscription id wasn't saved yet for some reason.
    accountId = matchedAccount?.id ?? subscriptionEntity.notes?.account_id ?? null;

    const nextStatus = mapEventToStatus(event);
    if (accountId && nextStatus) {
      const update: Record<string, unknown> = {
        subscription_status: nextStatus,
        current_period_start: toIso(subscriptionEntity.current_start),
        current_period_end: toIso(subscriptionEntity.current_end),
      };
      if (subscriptionEntity.customer_id) {
        update.razorpay_customer_id = subscriptionEntity.customer_id;
      }
      const notePlanId = subscriptionEntity.notes?.plan_id;
      if (nextStatus === "active" && isPlanId(notePlanId)) {
        update.plan_id = notePlanId;
      }

      const { error: updateError } = await admin
        .from("accounts")
        .update(update)
        .eq("id", accountId);
      if (updateError) {
        console.error(
          "[POST /api/billing/webhook] account update failed:",
          updateError,
        );
      }
    }
  }

  const { error: insertError } = await admin.from("billing_events").insert({
    account_id: accountId,
    // Events without an id header (shouldn't happen in practice) still
    // get logged under a synthetic key so the audit trail is complete.
    razorpay_event_id: eventId ?? `${event}:${Date.now()}`,
    event_type: event,
    payload: body,
  });
  if (insertError) {
    console.error(
      "[POST /api/billing/webhook] failed to log billing event:",
      insertError,
    );
  }

  return NextResponse.json({ received: true });
}
