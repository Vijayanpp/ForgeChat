-- ============================================================
-- 023_contact_lead_score
--
-- Persists AI-generated lead scores on contacts so the score
-- survives page navigations without re-calling the LLM.
--
-- Adds:
--   contacts.lead_score           INTEGER  (0–100, nullable)
--   contacts.lead_score_updated_at TIMESTAMPTZ (nullable)
--
-- Nullability: both columns are nullable so existing rows are
-- unaffected and the UI can distinguish "not yet scored" from
-- a scored contact.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score INTEGER
    CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)),
  ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.lead_score IS
  'AI-generated lead quality score 0–100. NULL = not yet scored.';

COMMENT ON COLUMN contacts.lead_score_updated_at IS
  'Timestamp of the last AI lead score calculation.';
