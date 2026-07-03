import type { SupabaseClient } from "@supabase/supabase-js";
import { RETENTION_GRACE_DAYS } from "@/lib/billing/plans";

// ============================================================
// Post-cancellation data retention/purge.
//
// Backs the Privacy Policy promise: 30 days after a subscription is
// canceled, the account's data is permanently deleted. Called from
// GET /api/billing/retention-purge (see that route for the cron/auth
// wiring) — kept separate so the logic is unit-testable without an
// HTTP layer.
//
// Scope: only `subscription_status = 'canceled'` accounts. Deliberately
// excludes 'past_due' (a failed *payment*, not a cancellation — the
// customer hasn't asked us to delete anything) and 'expired' (reserved
// for a lapsed-trial state nothing in this codebase sets yet).
// ============================================================

interface CandidateAccount {
  id: string;
  name: string;
  owner_user_id: string;
  billing_email: string | null;
  plan_id: string;
  subscription_status: string;
  current_period_end: string | null;
  updated_at: string;
}

export interface RetentionPurgeResult {
  accountId: string;
  accountName: string;
  retentionReferenceAt: string;
  purged: boolean;
  error?: string;
}

function retentionCutoffIso(): string {
  return new Date(Date.now() - RETENTION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Accounts canceled for longer than `RETENTION_GRACE_DAYS`, using
 * `current_period_end` (set by the webhook when the subscription
 * actually ends) as the reference point, falling back to `updated_at`
 * for the rare row where `current_period_end` was never populated.
 */
export async function findAccountsPendingPurge(
  admin: SupabaseClient,
): Promise<CandidateAccount[]> {
  const cutoff = retentionCutoffIso();

  const { data, error } = await admin
    .from("accounts")
    .select(
      "id, name, owner_user_id, billing_email, plan_id, subscription_status, current_period_end, updated_at",
    )
    .eq("subscription_status", "canceled")
    .or(`current_period_end.lt.${cutoff},and(current_period_end.is.null,updated_at.lt.${cutoff})`);

  if (error) {
    throw new Error(`[retention] failed to query candidate accounts: ${error.message}`);
  }

  return (data ?? []) as CandidateAccount[];
}

/**
 * Logs an audit row, then deletes the account. Every account-scoped
 * table cascades off `accounts.id` (ON DELETE CASCADE), so this single
 * statement removes contacts, conversations, messages, automations,
 * flows, broadcasts, etc. `billing_events.account_id` is ON DELETE SET
 * NULL, so the billing audit trail survives independently.
 *
 * Audit-log-then-delete (not the reverse) so a crash between the two
 * steps leaves an account still recoverable rather than a purge record
 * with no way to tell whether the delete actually happened — the next
 * cron run will simply find the account still matches and retry.
 */
export async function purgeAccount(
  admin: SupabaseClient,
  account: CandidateAccount,
): Promise<RetentionPurgeResult> {
  const retentionReferenceAt = account.current_period_end ?? account.updated_at;

  const { error: logError } = await admin.from("account_deletions").insert({
    account_id: account.id,
    account_name: account.name,
    owner_user_id: account.owner_user_id,
    billing_email: account.billing_email,
    plan_id: account.plan_id,
    subscription_status: account.subscription_status,
    retention_reference_at: retentionReferenceAt,
  });
  if (logError) {
    return {
      accountId: account.id,
      accountName: account.name,
      retentionReferenceAt,
      purged: false,
      error: `failed to write audit log: ${logError.message}`,
    };
  }

  const { error: deleteError } = await admin.from("accounts").delete().eq("id", account.id);
  if (deleteError) {
    return {
      accountId: account.id,
      accountName: account.name,
      retentionReferenceAt,
      purged: false,
      error: `failed to delete account: ${deleteError.message}`,
    };
  }

  return {
    accountId: account.id,
    accountName: account.name,
    retentionReferenceAt,
    purged: true,
  };
}
