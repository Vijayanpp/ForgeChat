import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendText } from "@/lib/automations/meta-send";
import { downloadWhatsAppImageDataUrl } from "@/lib/ai/resolve-message-media";

import type { AgentGraphDeps } from "../graph/shell";
import { parseAgentConfig } from "../kinds/catalog";
import { loadTranscript } from "../llm/context";
import { flushTraces } from "../observability/tracing";
import { ToolRequestError } from "../tools/http-tool";
import {
  isAgentKind,
  ZERO_USAGE,
  type ChatTurn,
  type GateFacts,
  type RuntimeAgent,
  type SessionState,
  type TurnResult,
} from "../types";
import { defaultAgentDeps } from "./deps";
import {
  claimAgentJobs,
  finishAgentJob,
  markAgentJobSent,
  retryAgentJob,
  type AgentJobRow,
} from "./jobs";
import { runAgentTurn } from "./run-turn";
import { loadSession, saveSession } from "./session-store";

function startOfMonthUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function gatherGateFacts(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    conversationStatus: string | null;
    session: SessionState;
    monthlyTokenBudget: number;
  },
): Promise<GateFacts> {
  const latestOf = (senderType?: string) => {
    let q = db
      .from("messages")
      .select("sender_type, created_at")
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (senderType) q = q.eq("sender_type", senderType);
    return q.maybeSingle();
  };

  const [latest, lastCustomer, lastHuman, usage] = await Promise.all([
    latestOf(),
    latestOf("customer"),
    latestOf("agent"),
    args.monthlyTokenBudget > 0
      ? db.rpc("ai_agent_token_usage", { p_account_id: args.accountId, p_since: startOfMonthUtc() })
      : Promise.resolve({ data: 0, error: null }),
  ]);

  const sender = latest.data?.sender_type as ChatTurn["sender"] | undefined;
  return {
    conversationStatus: args.conversationStatus,
    lastCustomerAt: (lastCustomer.data?.created_at as string | undefined) ?? null,
    lastHumanAt: (lastHuman.data?.created_at as string | undefined) ?? null,
    latestSender: sender ?? null,
    handedOff: args.session.handedOff,
    pausedUntil: args.session.pausedUntil,
    tokensUsedThisMonth: Number(usage.data ?? 0) || 0,
  };
}

async function recordRun(
  db: SupabaseClient,
  job: AgentJobRow,
  agent: RuntimeAgent | null,
  result: Pick<TurnResult, "outcome" | "skipReason" | "nodePath" | "usage" | "langsmithRunId">,
  latencyMs: number,
  error: string | null = null,
): Promise<void> {
  const { error: dbErr } = await db.from("ai_agent_runs").insert({
    account_id: job.account_id,
    agent_id: agent?.id ?? job.agent_id,
    agent_type: agent?.agent_type ?? null,
    config_version: agent?.config_version ?? null,
    conversation_id: job.conversation_id,
    job_id: job.id,
    outcome: result.outcome,
    skip_reason: result.skipReason,
    node_path: result.nodePath,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    latency_ms: latencyMs,
    langsmith_run_id: result.langsmithRunId,
    error,
  });
  if (dbErr) console.error("[agents] failed to record run", job.id, dbErr.message);
}

const EMPTY_RESULT = {
  skipReason: null,
  nodePath: [] as string[],
  usage: ZERO_USAGE,
  langsmithRunId: null,
};

function isRetryable(err: unknown): boolean {
  if (err instanceof ToolRequestError) return err.retryable;
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Process one claimed job end to end. Never throws. */
export async function processAgentJob(
  job: AgentJobRow,
  deps: AgentGraphDeps = defaultAgentDeps(),
): Promise<void> {
  const db = supabaseAdmin();
  const started = Date.now();
  let agent: RuntimeAgent | null = null;

  if (job.sent_message_id) {
    await finishAgentJob(db, job.id, "completed", "already sent before a restart");
    return;
  }
  if (job.attempts > deps.runtime.maxAttempts) {
    await finishAgentJob(db, job.id, "failed", "max attempts exceeded");
    return;
  }

  try {
    const { data: agentRow } = await db
      .from("ai_agents")
      .select("*")
      .eq("id", job.agent_id)
      .eq("account_id", job.account_id)
      .maybeSingle();
    agent = (agentRow as RuntimeAgent | null) ?? null;

    if (!agent || agent.status !== "active" || agent.engine !== "langgraph" || !isAgentKind(agent.agent_type)) {
      await finishAgentJob(db, job.id, "skipped", "agent missing, inactive or not a langgraph agent");
      return;
    }
    const kind = agent.agent_type;
    const parsed = parseAgentConfig(kind, agent.config);
    if (!parsed.ok) {
      await finishAgentJob(db, job.id, "failed", `invalid agent config: ${parsed.error}`);
      return;
    }

    const [{ data: conversation }, { data: contact }] = await Promise.all([
      db
        .from("conversations")
        .select("id, status")
        .eq("id", job.conversation_id)
        .eq("account_id", job.account_id)
        .maybeSingle(),
      db
        .from("contacts")
        .select("name")
        .eq("id", job.contact_id)
        .eq("account_id", job.account_id)
        .maybeSingle(),
    ]);
    if (!conversation) {
      await finishAgentJob(db, job.id, "skipped", "conversation not found for this account");
      return;
    }

    const sessionKey = { accountId: job.account_id, agentId: agent.id, conversationId: job.conversation_id };
    const [transcript, stored] = await Promise.all([
      loadTranscript(db, {
        accountId: job.account_id,
        conversationId: job.conversation_id,
        limit: agent.context_message_limit,
        downloadImage: downloadWhatsAppImageDataUrl,
      }),
      loadSession(db, sessionKey),
    ]);
    const gateFacts = await gatherGateFacts(db, {
      accountId: job.account_id,
      conversationId: job.conversation_id,
      conversationStatus: (conversation.status as string | null) ?? null,
      session: stored.state,
      monthlyTokenBudget: deps.runtime.monthlyTokenBudget,
    });

    const result = await runAgentTurn(
      {
        agent,
        kind,
        config: parsed.config,
        transcript,
        session: stored.state,
        contactName: (contact?.name as string | undefined) ?? "",
        gateFacts,
        conversationKey: job.conversation_id,
        refs: { conversationId: job.conversation_id, contactId: job.contact_id, userId: job.user_id },
      },
      deps,
      { metadata: { conversation_id: job.conversation_id, job_id: job.id } },
    );

    if (result.reply) {
      const { whatsapp_message_id } = await engineSendText({
        accountId: job.account_id,
        userId: job.user_id,
        conversationId: job.conversation_id,
        contactId: job.contact_id,
        text: result.reply,
        aiAgentId: agent.id,
      });
      job.sent_message_id = whatsapp_message_id;
      await markAgentJobSent(db, job.id, whatsapp_message_id);
    }

    if (result.outcome !== "skipped") {
      await saveSession(db, sessionKey, stored, result.session);
    }
    await recordRun(db, job, agent, result, Date.now() - started);
    await finishAgentJob(db, job.id, result.outcome === "skipped" ? "skipped" : "completed", result.skipReason);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agents] job failed", job.id, message);
    await recordRun(db, job, agent, { ...EMPTY_RESULT, outcome: "failed" }, Date.now() - started, message);

    if (job.sent_message_id) {
      // The customer already has the reply; only bookkeeping failed.
      await finishAgentJob(db, job.id, "completed", `post-send error: ${message}`);
    } else if (isRetryable(err) && job.attempts < deps.runtime.maxAttempts) {
      await retryAgentJob(db, job.id, 5_000 * 2 ** (job.attempts - 1), message);
    } else {
      await finishAgentJob(db, job.id, "failed", message);
    }
  }
}

/**
 * Claim and process due jobs until the queue is empty or the time
 * budget is spent. Jobs in one batch belong to different
 * conversations (enforced by the claim RPC), so they run in parallel.
 */
export async function drainAgentJobs(
  opts: { batchSize?: number; timeBudgetMs?: number; deps?: AgentGraphDeps } = {},
): Promise<{ processed: number }> {
  const db = supabaseAdmin();
  const deadline = Date.now() + (opts.timeBudgetMs ?? 50_000);
  let processed = 0;

  while (Date.now() < deadline) {
    const jobs = await claimAgentJobs(db, opts.batchSize ?? 5);
    if (jobs.length === 0) break;
    await Promise.allSettled(jobs.map((job) => processAgentJob(job, opts.deps)));
    processed += jobs.length;
  }

  await flushTraces();
  return { processed };
}
