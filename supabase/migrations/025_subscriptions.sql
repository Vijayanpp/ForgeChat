-- ============================================================
-- 025_subscriptions
--
-- Adds SaaS subscription/billing state to `accounts` and an audit
-- log of inbound Razorpay webhook events. See src/lib/billing/plans.ts
-- for the plan catalogue (tiers, INR pricing, usage limits) that these
-- columns reference by id.
--
-- Backfill strategy for EXISTING accounts (pre-migration installs):
--   `plan_id` defaults to 'business' and `subscription_status' to
--   'active' — i.e. existing accounts are grandfathered onto the
--   top tier with no trial clock, so self-hosted / already-running
--   deployments are never locked out by this migration. Only
--   NEW signups (via the updated handle_new_user() trigger below)
--   get 'trial' / 'trialing' with a 14-day trial_ends_at.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ACCOUNTS — subscription columns
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  -- Defaults to the owner's email at signup; editable independently
  -- so billing notices can go to a shared inbox instead of a person.
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_plan_id_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_plan_id_check
  CHECK (plan_id IN ('trial', 'starter', 'growth', 'pro', 'business'));

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_subscription_status_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'expired'));

-- Webhook handler looks accounts up by Razorpay subscription id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_razorpay_subscription
  ON accounts(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- ============================================================
-- BILLING_EVENTS — webhook audit log + idempotency
--
-- Every verified Razorpay webhook delivery is recorded here keyed by
-- its own event id, so a redelivered webhook (Razorpay retries on
-- non-2xx) is a no-op rather than double-applying a state change.
-- Service-role only — this is an internal audit trail, never read
-- from the browser.
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  razorpay_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_account
  ON billing_events(account_id, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- No client policies — service role (webhook route) is the only writer
-- and reader. RLS with zero policies denies all client access by default.

-- ============================================================
-- SIGNUP TRIGGER — new accounts start on a 14-day trial
--
-- Replaces the 017_account_sharing.sql version to additionally seed
-- plan_id='trial', subscription_status='trialing', and trial_ends_at.
-- Explicit INSERT values here override the grandfathering column
-- defaults above, so this only affects rows created from this point
-- forward.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (
    name, owner_user_id, plan_id, subscription_status, trial_ends_at, billing_email
  )
  VALUES (
    COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'),
    NEW.id,
    'trial',
    'trialing',
    NOW() + INTERVAL '14 days',
    NEW.email
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
