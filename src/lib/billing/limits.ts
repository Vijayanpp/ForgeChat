// ============================================================
// Plan limit enforcement — usage counting + guard helpers called
// from write-path API routes (invite member, launch broadcast,
// create automation/flow/AI agent) before an insert happens.
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PLANS,
  isPlanId,
  isReadOnlyStatus,
  type PlanId,
  type SubscriptionStatus,
} from "./plans";

export type LimitResource =
  | "seats"
  | "contacts"
  | "broadcastsPerMonth"
  | "automations"
  | "flows"
  | "aiAgents";

export interface UsageCounts {
  seats: number;
  contacts: number;
  broadcastsPerMonth: number;
  automations: number;
  flows: number;
  aiAgents: number;
}

function startOfCurrentMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** One lightweight `count`-only query for a single metered resource. */
async function countResource(
  supabase: SupabaseClient,
  accountId: string,
  resource: LimitResource,
): Promise<number> {
  let query;
  switch (resource) {
    case "seats":
      query = supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      break;
    case "contacts":
      query = supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      break;
    case "broadcastsPerMonth":
      query = supabase
        .from("broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .gte("created_at", startOfCurrentMonthIso());
      break;
    case "automations":
      query = supabase
        .from("automations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      break;
    case "flows":
      query = supabase
        .from("flows")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      break;
    case "aiAgents":
      query = supabase
        .from("ai_agents")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      break;
  }
  const { count, error } = await query;
  if (error) {
    console.error(`[billing/limits] count query failed for ${resource}:`, error);
    return 0; // fail open on read errors — never block a write due to a count-query hiccup
  }
  return count ?? 0;
}

/** All six usage counts in parallel — used by GET /api/billing/status
 *  and the Settings → Billing usage meters. */
export async function getUsageCounts(
  supabase: SupabaseClient,
  accountId: string,
): Promise<UsageCounts> {
  const resources: LimitResource[] = [
    "seats",
    "contacts",
    "broadcastsPerMonth",
    "automations",
    "flows",
    "aiAgents",
  ];
  const counts = await Promise.all(
    resources.map((r) => countResource(supabase, accountId, r)),
  );
  const result = {} as UsageCounts;
  resources.forEach((resource, i) => {
    result[resource] = counts[i];
  });
  return result;
}

/** Loads the plan + subscription status a write-path route needs to
 *  enforce limits. Fails open (treats the account as the top,
 *  unrestricted tier) on a lookup error rather than blocking every
 *  write in the account because of a transient read failure. */
export async function getAccountBilling(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ planId: PlanId; subscriptionStatus: SubscriptionStatus }> {
  const { data, error } = await supabase
    .from("accounts")
    .select("plan_id, subscription_status")
    .eq("id", accountId)
    .single();
  if (error || !data) {
    console.error("[billing/limits] failed to load account billing state:", error);
    return { planId: "pro", subscriptionStatus: "active" };
  }
  return {
    planId: isPlanId(data.plan_id) ? data.plan_id : "pro",
    subscriptionStatus: (data.subscription_status as SubscriptionStatus) ?? "active",
  };
}

export class PlanLimitError extends Error {
  readonly status = 402 as const;
  constructor(
    public readonly resource: LimitResource,
    public readonly limit: number,
  ) {
    super(
      `You've reached your plan's limit for ${resource} (max ${limit}). Upgrade your plan to continue.`,
    );
    this.name = "PlanLimitError";
  }
}

export class AccountReadOnlyError extends Error {
  readonly status = 402 as const;
  constructor() {
    super(
      "Your subscription is inactive. Update your billing details in Settings to continue.",
    );
    this.name = "AccountReadOnlyError";
  }
}

/** Throws `AccountReadOnlyError` when the account's subscription is
 *  past_due / canceled / expired. Call this first, before any
 *  resource-specific limit check, on every write-path route. */
export function assertAccountWritable(status: SubscriptionStatus): void {
  if (isReadOnlyStatus(status)) {
    throw new AccountReadOnlyError();
  }
}

/** Throws `PlanLimitError` if adding one more `resource` would exceed
 *  the plan's limit. Call BEFORE inserting the new row. A `null` limit
 *  on the plan means unlimited and short-circuits without a query. */
export async function assertWithinLimit(
  supabase: SupabaseClient,
  accountId: string,
  planId: PlanId,
  resource: LimitResource,
): Promise<void> {
  const limit = PLANS[planId].limits[resource];
  if (limit === null) return;

  const current = await countResource(supabase, accountId, resource);
  if (current >= limit) {
    throw new PlanLimitError(resource, limit);
  }
}

/** Maps the two billing error classes to a JSON response; returns
 *  `null` for anything else so callers can fall through to their
 *  own generic error handling (e.g. `toErrorResponse` from
 *  `@/lib/auth/account`). */
export function toBillingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof PlanLimitError) {
    return NextResponse.json(
      { error: err.message, code: "plan_limit", resource: err.resource },
      { status: err.status },
    );
  }
  if (err instanceof AccountReadOnlyError) {
    return NextResponse.json(
      { error: err.message, code: "read_only" },
      { status: err.status },
    );
  }
  return null;
}
