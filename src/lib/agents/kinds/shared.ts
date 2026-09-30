import type { ModelSpec } from "../llm/toolkit";
import type { AgentKind } from "../types";
import type { SpecialistContext } from "./contract";

/** Model used for the customer-facing reply. Vision turns force a vision model. */
export function replySpec(
  ctx: SpecialistContext<AgentKind>,
  opts: { vision?: boolean; maxTokens?: number } = {},
): ModelSpec {
  return {
    model: opts.vision ? ctx.runtime.visionModel : ctx.agent.model || "gpt-4o",
    temperature: Number.isFinite(ctx.agent.temperature) ? ctx.agent.temperature : 0.7,
    maxTokens: opts.maxTokens ?? 600,
  };
}

/** Cheap deterministic model for extraction / control decisions. */
export function controlSpec(
  ctx: Pick<SpecialistContext<AgentKind>, "runtime">,
  maxTokens = 400,
): ModelSpec {
  return { model: ctx.runtime.controlModel, temperature: 0, maxTokens };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(value))) {
    if (typeof v === "string" && v.trim()) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}
