-- ============================================================
-- 033_ai_agent_paid_reports
--
-- Paid report flow for smart agents (palm reading):
--   * ai_agent_payments  — payment screenshots and their verification.
--                          A transaction reference can back only one
--                          non-rejected payment per account (no reuse).
--   * ai_agent_reports   — durable report jobs: generate → email →
--                          WhatsApp notify, each step recorded so a
--                          retry never repeats a finished step.
--   * ai_agent_secrets   — per-agent provider credentials (Razorpay).
--                          RLS on, no policies: service role only.
--
-- RLS: members read payments/reports; only the service role writes.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_agent_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  screenshot_message_id UUID,
  status TEXT NOT NULL CHECK (status IN ('verified', 'pending_review', 'rejected')),
  verified_by TEXT CHECK (verified_by IN ('screenshot', 'razorpay_api', 'human')),
  amount_paise BIGINT,
  currency TEXT,
  payee TEXT,
  reference TEXT,
  provider_payment_id TEXT,
  paid_at TIMESTAMPTZ,
  extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_payments_reference
  ON ai_agent_payments(account_id, reference)
  WHERE reference IS NOT NULL AND status <> 'rejected';

CREATE INDEX IF NOT EXISTS idx_ai_agent_payments_account_status
  ON ai_agent_payments(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_payments_conversation
  ON ai_agent_payments(conversation_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON ai_agent_payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_agent_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS ai_agent_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES ai_agent_payments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  subject JSONB NOT NULL,
  palm_media TEXT[] NOT NULL DEFAULT '{}',
  chart JSONB,
  content JSONB,
  html TEXT,
  access_token_hash TEXT NOT NULL,
  email_to TEXT NOT NULL,
  generated_at TIMESTAMPTZ,
  email_message_id TEXT,
  emailed_at TIMESTAMPTZ,
  notified_message_id TEXT,
  notified_at TIMESTAMPTZ,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_agent_reports_payment_unique UNIQUE (payment_id),
  CONSTRAINT ai_agent_reports_token_unique UNIQUE (access_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_reports_due
  ON ai_agent_reports(run_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ai_agent_reports_account_created
  ON ai_agent_reports(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON ai_agent_reports;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_agent_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS ai_agent_secrets (
  agent_id UUID PRIMARY KEY REFERENCES ai_agents(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  razorpay_key_id TEXT,
  razorpay_key_secret_enc TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_agent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_payments_select ON ai_agent_payments;
CREATE POLICY ai_agent_payments_select ON ai_agent_payments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_agent_reports_select ON ai_agent_reports;
CREATE POLICY ai_agent_reports_select ON ai_agent_reports FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- claim_ai_agent_reports: lease due report jobs. Expired leases
-- (crash / deploy mid-run) go back to pending; step markers on the
-- row make the retry resume where it stopped.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_ai_agent_reports(
  p_limit INTEGER,
  p_lease_seconds INTEGER DEFAULT 600
)
RETURNS SETOF ai_agent_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ai_agent_reports
  SET status = 'pending', started_at = NULL
  WHERE status = 'running'
    AND started_at < NOW() - make_interval(secs => p_lease_seconds);

  RETURN QUERY
  WITH due AS (
    SELECT r.id FROM ai_agent_reports r
    WHERE r.status = 'pending'
      AND r.run_after <= NOW()
    ORDER BY r.run_after
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ai_agent_reports r
  SET status = 'running',
      started_at = NOW(),
      attempts = r.attempts + 1
  FROM due
  WHERE r.id = due.id
  RETURNING r.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_ai_agent_reports(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_ai_agent_reports(INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION claim_ai_agent_reports(INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_ai_agent_reports(INTEGER, INTEGER) TO service_role;
