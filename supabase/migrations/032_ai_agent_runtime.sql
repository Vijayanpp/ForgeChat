-- ============================================================
-- 032_ai_agent_runtime
--
-- LangGraph agent runtime: per-agent engine/kind/config, durable
-- debounced reply jobs, per-conversation agent session state, and
-- a run ledger for usage + tracing.
--
-- Existing agents keep engine = 'legacy' and behave exactly as
-- before. Sessions, jobs and runs are written only by the service
-- role (the runtime); members can read them for their account.
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- ai_agents: engine / kind / config
-- ------------------------------------------------------------

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_agents_engine_check;
ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_engine_check CHECK (engine IN ('legacy', 'langgraph'));

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS agent_type TEXT;
ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_agents_agent_type_check;
ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_agent_type_check CHECK (
    agent_type IS NULL
    OR agent_type IN ('customer_service', 'palm_reading', 'ticket_booking', 'sales')
  );

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_agents_langgraph_requires_type;
ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_langgraph_requires_type
  CHECK (engine <> 'langgraph' OR agent_type IS NOT NULL);

-- ------------------------------------------------------------
-- ai_agent_sessions: structured memory per conversation.
-- The transcript itself stays in `messages`; this holds only
-- slots / stage / summary plus human-control flags.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_agent_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'new',
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  handed_off BOOLEAN NOT NULL DEFAULT FALSE,
  paused_until TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_agent_sessions_conversation_unique UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_account
  ON ai_agent_sessions(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON ai_agent_sessions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_agent_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- ai_agent_jobs: durable, debounced reply work.
--   * one pending job per conversation (debounce target)
--   * one running job per conversation (serialisation)
--   * one job per (conversation, trigger message) (idempotency)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_agent_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_message_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  sent_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_jobs_pending_per_conversation
  ON ai_agent_jobs(conversation_id) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_jobs_running_per_conversation
  ON ai_agent_jobs(conversation_id) WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_jobs_trigger
  ON ai_agent_jobs(conversation_id, trigger_message_id)
  WHERE trigger_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_agent_jobs_due
  ON ai_agent_jobs(run_after) WHERE status = 'pending';

-- ------------------------------------------------------------
-- ai_agent_runs: one row per processed turn.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  agent_type TEXT,
  config_version INTEGER,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  job_id UUID REFERENCES ai_agent_jobs(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('replied', 'handed_off', 'skipped', 'failed')),
  skip_reason TEXT,
  node_path TEXT[] NOT NULL DEFAULT '{}',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  langsmith_run_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_account_created
  ON ai_agent_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_created
  ON ai_agent_runs(agent_id, created_at DESC);

-- ------------------------------------------------------------
-- RLS: members read; only the service role writes.
-- ------------------------------------------------------------

ALTER TABLE ai_agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_sessions_select ON ai_agent_sessions;
CREATE POLICY ai_agent_sessions_select ON ai_agent_sessions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_agent_jobs_select ON ai_agent_jobs;
CREATE POLICY ai_agent_jobs_select ON ai_agent_jobs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_agent_runs_select ON ai_agent_runs;
CREATE POLICY ai_agent_runs_select ON ai_agent_runs FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- enqueue_ai_agent_job: idempotent + debounced enqueue.
--   1. A job already exists for this trigger message -> return it.
--   2. A pending job exists for the conversation -> push run_after
--      forward and retarget it at the newest trigger message.
--   3. Otherwise insert a new pending job.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enqueue_ai_agent_job(
  p_account_id UUID,
  p_agent_id UUID,
  p_user_id UUID,
  p_conversation_id UUID,
  p_contact_id UUID,
  p_trigger_message_id UUID,
  p_debounce_ms INTEGER
)
RETURNS TABLE (job_id UUID, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_run_after TIMESTAMPTZ := NOW() + make_interval(secs => GREATEST(p_debounce_ms, 0) / 1000.0);
BEGIN
  IF p_trigger_message_id IS NOT NULL THEN
    SELECT j.id INTO v_id FROM ai_agent_jobs j
    WHERE j.conversation_id = p_conversation_id
      AND j.trigger_message_id = p_trigger_message_id
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'duplicate'::TEXT;
      RETURN;
    END IF;
  END IF;

  FOR i IN 1..3 LOOP
    UPDATE ai_agent_jobs j
    SET run_after = v_run_after,
        agent_id = p_agent_id,
        user_id = p_user_id,
        trigger_message_id = COALESCE(p_trigger_message_id, j.trigger_message_id)
    WHERE j.conversation_id = p_conversation_id
      AND j.status = 'pending'
    RETURNING j.id INTO v_id;

    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'debounced'::TEXT;
      RETURN;
    END IF;

    BEGIN
      INSERT INTO ai_agent_jobs (
        account_id, agent_id, user_id, conversation_id, contact_id,
        trigger_message_id, status, run_after
      ) VALUES (
        p_account_id, p_agent_id, p_user_id, p_conversation_id, p_contact_id,
        p_trigger_message_id, 'pending', v_run_after
      )
      RETURNING id INTO v_id;
      RETURN QUERY SELECT v_id, 'enqueued'::TEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent enqueue won the race; loop and debounce onto it.
      NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'enqueue_ai_agent_job: could not enqueue after retries';
END;
$$;

REVOKE ALL ON FUNCTION enqueue_ai_agent_job(UUID, UUID, UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION enqueue_ai_agent_job(UUID, UUID, UUID, UUID, UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION enqueue_ai_agent_job(UUID, UUID, UUID, UUID, UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION enqueue_ai_agent_job(UUID, UUID, UUID, UUID, UUID, UUID, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- claim_ai_agent_jobs: lease due jobs, never two per conversation.
-- Jobs stuck in 'running' past the lease are returned to pending
-- (process crash / deploy mid-run).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_ai_agent_jobs(
  p_limit INTEGER,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF ai_agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A newer pending job already supersedes an expired lease.
  UPDATE ai_agent_jobs
  SET status = 'failed', finished_at = NOW(), last_error = 'lease expired'
  WHERE status = 'running'
    AND started_at < NOW() - make_interval(secs => p_lease_seconds)
    AND EXISTS (
      SELECT 1 FROM ai_agent_jobs p
      WHERE p.conversation_id = ai_agent_jobs.conversation_id
        AND p.status = 'pending'
    );

  UPDATE ai_agent_jobs
  SET status = 'pending', started_at = NULL
  WHERE status = 'running'
    AND started_at < NOW() - make_interval(secs => p_lease_seconds)
    AND NOT EXISTS (
      SELECT 1 FROM ai_agent_jobs p
      WHERE p.conversation_id = ai_agent_jobs.conversation_id
        AND p.status = 'pending'
    );

  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM ai_agent_jobs j
    WHERE j.status = 'pending'
      AND j.run_after <= NOW()
      AND NOT EXISTS (
        SELECT 1 FROM ai_agent_jobs r
        WHERE r.conversation_id = j.conversation_id
          AND r.status = 'running'
      )
    ORDER BY j.run_after
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ai_agent_jobs j
  SET status = 'running',
      started_at = NOW(),
      attempts = j.attempts + 1
  FROM due
  WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_ai_agent_jobs(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_ai_agent_jobs(INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION claim_ai_agent_jobs(INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_ai_agent_jobs(INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- ai_agent_token_usage: tokens consumed by an account since a
-- point in time (monthly budget gate).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION ai_agent_token_usage(
  p_account_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::BIGINT
  FROM ai_agent_runs
  WHERE account_id = p_account_id
    AND created_at >= p_since;
$$;

REVOKE ALL ON FUNCTION ai_agent_token_usage(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_agent_token_usage(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION ai_agent_token_usage(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION ai_agent_token_usage(UUID, TIMESTAMPTZ) TO service_role;
