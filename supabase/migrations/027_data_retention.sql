-- ============================================================
-- 027_data_retention
--
-- Backs the Privacy Policy promise (see
-- src/components/legal/privacy-content.tsx, "Data retention and
-- deletion"): 30 days after a subscription is canceled, the
-- account's data is permanently deleted from active systems.
--
-- `account_deletions` is a standalone audit table (no FK back to
-- `accounts` — the whole point is that the account row is gone by
-- the time this is read) recording *that* a purge happened, for
-- support/compliance purposes, without retaining any of the actual
-- CRM data (contacts, messages, etc.) that got deleted.
--
-- The actual purge is a single `DELETE FROM accounts WHERE id = ...`
-- run from a service-role context (see src/lib/billing/retention.ts)
-- — every account-scoped table already has `account_id ... ON DELETE
-- CASCADE`, and `billing_events.account_id` is `ON DELETE SET NULL`,
-- so the billing/audit trail survives independent of the account.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Snapshot of the account at deletion time — not a live FK, since
  -- the referenced account no longer exists once this row is written.
  account_id UUID NOT NULL,
  account_name TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  billing_email TEXT,
  plan_id TEXT NOT NULL,
  subscription_status TEXT NOT NULL,
  -- The subscription_status = 'canceled' reference timestamp the
  -- 30-day grace period was measured from (current_period_end, or
  -- accounts.updated_at when that was never set).
  retention_reference_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT 'post_cancellation_retention',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_deleted_at
  ON account_deletions(deleted_at DESC);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
-- No client policies — service role (the retention-purge route) is
-- the only writer and reader. RLS with zero policies denies all
-- client access by default.
