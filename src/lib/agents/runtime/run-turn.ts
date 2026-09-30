import { buildAgentGraph, type AgentGraphDeps, type AgentTurnInput } from "../graph/shell";
import type { SpecialistResult } from "../kinds/contract";
import { traceConfig } from "../observability/tracing";
import type { SessionState, TurnResult } from "../types";

const graphs = new WeakMap<AgentGraphDeps, ReturnType<typeof buildAgentGraph>>();

function graphFor(deps: AgentGraphDeps) {
  let graph = graphs.get(deps);
  if (!graph) {
    graph = buildAgentGraph(deps);
    graphs.set(deps, graph);
  }
  return graph;
}

export function mergeSession(
  session: SessionState,
  patch: SpecialistResult["session"],
  handoff: boolean,
): SessionState {
  return {
    stage: patch?.stage ?? session.stage,
    slots: patch?.slots ?? session.slots,
    summary: patch?.summary !== undefined ? patch.summary : session.summary,
    handedOff: session.handedOff || handoff,
    pausedUntil: session.pausedUntil,
  };
}

export async function runAgentTurn(
  input: AgentTurnInput,
  deps: AgentGraphDeps,
  opts: { tags?: string[]; metadata?: Record<string, string | number | boolean | null> } = {},
): Promise<TurnResult> {
  const { config, runId } = traceConfig({
    runName: `agent:${input.kind}`,
    tags: ["forgechat-agent", input.kind, ...(opts.tags ?? [])],
    metadata: {
      account_id: input.agent.account_id,
      agent_id: input.agent.id,
      agent_type: input.kind,
      config_version: input.agent.config_version,
      ...opts.metadata,
    },
    sampleRate: deps.runtime.traceSampleRate,
  });

  const final = await graphFor(deps).invoke(
    { input },
    {
      ...config,
      recursionLimit: 12,
      signal: AbortSignal.timeout(deps.runtime.turnTimeoutMs),
    },
  );

  const outcome = final.skipReason
    ? "skipped"
    : final.handoff
      ? "handed_off"
      : final.reply
        ? "replied"
        : "skipped";

  return {
    outcome,
    reply: outcome === "skipped" ? null : final.reply,
    skipReason: final.skipReason,
    session: mergeSession(input.session, final.sessionPatch, final.handoff),
    nodePath: final.nodePath,
    usage: final.usage,
    langsmithRunId: runId,
  };
}
