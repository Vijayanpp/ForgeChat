-- ============================================================
-- 031_affiliate_link
--
-- Per-account affiliate / partner link shown in the Inbox
-- composer. Admin configures label + URL in Settings; all
-- account members see it when enabled.
--
-- RLS: no change needed — accounts_update (017) already
-- restricts writes to admins+.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS affiliate_link_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS affiliate_link_label TEXT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS affiliate_link_url TEXT;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_affiliate_link_url_when_enabled;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_affiliate_link_url_when_enabled
  CHECK (
    NOT affiliate_link_enabled
    OR (
      affiliate_link_url IS NOT NULL
      AND affiliate_link_url ~ '^https://'
      AND length(affiliate_link_url) <= 2048
    )
  );
