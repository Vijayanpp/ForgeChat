// ============================================================
// Subscription plan catalogue — single source of truth for the
// plan tier, INR pricing, and usage limits.
//
// Pure data + pure helpers only (no Supabase/Razorpay imports) so
// this module is safe to import from both server and client code
// (pricing page, settings billing tab, and the server-side limit
// enforcement in `@/lib/billing/limits`).
// ============================================================

export type PlanId = "trial" | "pro";
export type BillingInterval = "monthly" | "yearly";

/** Mirrors `accounts.subscription_status` in migration 025_subscriptions.sql. */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

/** `null` means unlimited. */
export interface PlanLimits {
  seats: number | null;
  contacts: number | null;
  broadcastsPerMonth: number | null;
  automations: number | null;
  flows: number | null;
  aiAgents: number | null;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** INR, in whole rupees. `null` = not independently purchasable (trial). */
  priceMonthlyInr: number | null;
  priceYearlyInr: number | null;
  limits: PlanLimits;
  features: string[];
  /** Env var names holding the Razorpay plan id for each interval. */
  razorpayEnv: { monthly: string; yearly: string } | null;
}

export const TRIAL_DAYS = 14;

/**
 * Days a canceled account's data is retained before the retention-purge
 * job permanently deletes it. Mirrors the promise in the Privacy Policy
 * ("Data retention and deletion") — see src/lib/billing/retention.ts.
 */
export const RETENTION_GRACE_DAYS = 30;

/** No per-resource caps — every account, trial or paid, gets the full product. */
const UNLIMITED_LIMITS: PlanLimits = {
  seats: null,
  contacts: null,
  broadcastsPerMonth: null,
  automations: null,
  flows: null,
  aiAgents: null,
};

/** Plans a customer can actually subscribe to, in display order. */
export const PURCHASABLE_PLAN_IDS: readonly PlanId[] = ["pro"];

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: {
    id: "trial",
    name: "Trial",
    tagline: `${TRIAL_DAYS}-day free trial — full access to every feature`,
    priceMonthlyInr: null,
    priceYearlyInr: null,
    limits: UNLIMITED_LIMITS,
    features: [],
    razorpayEnv: null,
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Everything you need to run WhatsApp CRM, no limits",
    priceMonthlyInr: 999,
    priceYearlyInr: 9_990,
    limits: UNLIMITED_LIMITS,
    features: [
      "Unlimited team seats",
      "Unlimited contacts",
      "Unlimited broadcasts",
      "Unlimited automations & visual flows",
      "Unlimited AI reply agents",
      "Shared inbox with lead scoring & pipelines",
      "WhatsApp message templates",
      "Priority support",
    ],
    razorpayEnv: {
      monthly: "RAZORPAY_PLAN_PRO_MONTHLY",
      yearly: "RAZORPAY_PLAN_PRO_YEARLY",
    },
  },
};

export function getPlan(id: PlanId): PlanDefinition {
  return PLANS[id];
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && value in PLANS;
}

/** Statuses under which the account should be treated as read-only. */
export function isReadOnlyStatus(status: SubscriptionStatus): boolean {
  return status === "past_due" || status === "canceled" || status === "expired";
}

export function formatInr(amountRupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amountRupees);
}
