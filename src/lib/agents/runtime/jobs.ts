import type { SupabaseClient } from "@supabase/supabase-js";

export interface AgentJobRow {
  id: string;
  account_id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  contact_id: string;
  trigger_message_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  run_after: string;
  attempts: number;
  sent_message_id: string | null;
}

export interface EnqueueArgs {
  accountId: string;
  agentId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  triggerMessageId: string | null;
  debounceMs: number;
}

export type EnqueueOutcome = "enqueued" | "debounced" | "duplicate";

export async function enqueueAgentJob(
  db: SupabaseClient,
  args: EnqueueArgs,
): Promise<{ jobId: string; outcome: EnqueueOutcome }> {
  const { data, error } = await db.rpc("enqueue_ai_agent_job", {
    p_account_id: args.accountId,
    p_agent_id: args.agentId,
    p_user_id: args.userId,
    p_conversation_id: args.conversationId,
    p_contact_id: args.contactId,
    p_trigger_message_id: args.triggerMessageId,
    p_debounce_ms: args.debounceMs,
  });
  if (error) throw new Error(`failed to enqueue agent job: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { job_id: string; outcome: EnqueueOutcome } | null;
  if (!row?.job_id) throw new Error("enqueue_ai_agent_job returned no job");
  return { jobId: row.job_id, outcome: row.outcome };
}

export async function claimAgentJobs(db: SupabaseClient, limit: number): Promise<AgentJobRow[]> {
  const { data, error } = await db.rpc("claim_ai_agent_jobs", { p_limit: limit, p_lease_seconds: 300 });
  if (error) throw new Error(`failed to claim agent jobs: ${error.message}`);
  return (data ?? []) as AgentJobRow[];
}

export async function finishAgentJob(
  db: SupabaseClient,
  jobId: string,
  status: "completed" | "failed" | "skipped",
  error: string | null = null,
): Promise<void> {
  const { error: dbErr } = await db
    .from("ai_agent_jobs")
    .update({ status, finished_at: new Date().toISOString(), last_error: error })
    .eq("id", jobId);
  if (dbErr) console.error("[agents] failed to finish job", jobId, dbErr.message);
}

/** Record the Meta id immediately after sending so a retry never re-sends. */
export async function markAgentJobSent(db: SupabaseClient, jobId: string, waMessageId: string): Promise<void> {
  const { error } = await db.from("ai_agent_jobs").update({ sent_message_id: waMessageId }).eq("id", jobId);
  if (error) console.error("[agents] failed to record sent message", jobId, error.message);
}

/**
 * Put a failed job back in the queue. If a newer pending job already
 * exists for the conversation it supersedes this one.
 */
export async function retryAgentJob(
  db: SupabaseClient,
  jobId: string,
  delayMs: number,
  error: string,
): Promise<boolean> {
  const { error: dbErr } = await db
    .from("ai_agent_jobs")
    .update({
      status: "pending",
      started_at: null,
      run_after: new Date(Date.now() + delayMs).toISOString(),
      last_error: error,
    })
    .eq("id", jobId);
  if (!dbErr) return true;
  await finishAgentJob(db, jobId, "failed", dbErr.code === "23505" ? `${error} (superseded)` : error);
  return false;
}

/** Milliseconds until the next pending job is due, or null when idle. */
export async function nextPendingDueInMs(db: SupabaseClient): Promise<number | null> {
  const { data } = await db
    .from("ai_agent_jobs")
    .select("run_after")
    .eq("status", "pending")
    .order("run_after", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.run_after) return null;
  return Math.max(0, new Date(data.run_after as string).getTime() - Date.now());
}
