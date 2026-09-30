import { randomUUID } from "node:crypto";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Client } from "langsmith";

import { redactValue } from "./redact";

let client: Client | null = null;

/**
 * Tracing is opt-in via AI_AGENT_LANGSMITH_TRACING rather than the
 * global LANGSMITH_TRACING flag: the global flag makes LangChain
 * attach its own un-redacted tracer to every call.
 */
export function agentTracingEnabled(): boolean {
  return process.env.AI_AGENT_LANGSMITH_TRACING === "true" && Boolean(process.env.LANGSMITH_API_KEY);
}

function tracingClient(): Client {
  if (!client) {
    client = new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      apiUrl: process.env.LANGSMITH_ENDPOINT || undefined,
      hideInputs: (inputs) => redactValue(inputs),
      hideOutputs: (outputs) => redactValue(outputs),
    });
  }
  return client;
}

/** Flush queued trace batches (call before a short-lived invocation returns). */
export async function flushTraces(): Promise<void> {
  if (client) await client.awaitPendingTraceBatches().catch(() => undefined);
}

export interface TraceMeta {
  runName: string;
  tags: string[];
  metadata: Record<string, string | number | boolean | null>;
  sampleRate: number;
}

/**
 * RunnableConfig fragment that routes this invocation's trace through
 * the redacting client. Returns the root run id when traced.
 */
export function traceConfig(meta: TraceMeta): { config: RunnableConfig; runId: string | null } {
  const base: RunnableConfig = { runName: meta.runName, tags: meta.tags, metadata: meta.metadata };
  if (!agentTracingEnabled() || Math.random() >= meta.sampleRate) {
    return { config: base, runId: null };
  }
  const runId = randomUUID();
  const tracer = new LangChainTracer({
    client: tracingClient(),
    projectName: process.env.LANGSMITH_PROJECT || "ForgeChat Agents",
  });
  return { config: { ...base, runId, callbacks: [tracer] }, runId };
}
