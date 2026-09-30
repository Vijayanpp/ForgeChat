import { supabaseAdmin } from "@/lib/automations/admin-client";

import { agentRuntimeConfig } from "./config";
import { scheduleAgentDrain } from "./runtime/dispatcher";
import { enqueueAgentJob, type EnqueueOutcome } from "./runtime/jobs";

export { agentRuntimeConfig } from "./config";
export { drainAgentJobs } from "./runtime/worker";

/** Whether an agent row should run on the LangGraph runtime right now. */
export function usesLangGraphRuntime(agent: { engine?: string | null }): boolean {
  return agent.engine === "langgraph" && agentRuntimeConfig().enabled;
}

/**
 * Entry point from the automation `ai_reply` step. Queues a debounced,
 * idempotent reply job for the conversation and returns immediately.
 */
export async function enqueueAgentTurn(args: {
  accountId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  contactId: string;
}): Promise<{ jobId: string; outcome: EnqueueOutcome }> {
  const db = supabaseAdmin();
  const runtime = agentRuntimeConfig();

  const { data: trigger } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const result = await enqueueAgentJob(db, {
    ...args,
    triggerMessageId: (trigger?.id as string | undefined) ?? null,
    debounceMs: runtime.debounceMs,
  });

  if (result.outcome !== "duplicate") scheduleAgentDrain(runtime.debounceMs + 250);
  return result;
}
