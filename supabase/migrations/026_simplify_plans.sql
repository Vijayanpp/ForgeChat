-- ============================================================
-- 026_simplify_plans
--
-- Collapses the plan catalogue from 4 purchasable tiers
-- (starter/growth/pro/business) down to a single "pro" plan with
-- unlimited usage, billed monthly or yearly. See
-- src/lib/billing/plans.ts for the (now much smaller) catalogue.
--
-- Any account previously on starter/growth/business is migrated to
-- 'pro' — those tiers no longer exist, and 'pro' already carries
-- unlimited limits so no account loses functionality. 'trial' is
-- untouched.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

UPDATE accounts
  SET plan_id = 'pro'
  WHERE plan_id IN ('starter', 'growth', 'business');

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_plan_id_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_plan_id_check
  CHECK (plan_id IN ('trial', 'pro'));
