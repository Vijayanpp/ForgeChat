import { randomBytes } from "node:crypto";

import { parseAgentConfig } from "./kinds/catalog";
import { isAgentKind, type AgentEngine, type AgentKind } from "./types";

interface ExistingRuntimeFields {
  engine?: string | null;
  agent_type?: string | null;
  config?: unknown;
}

export type RuntimeFieldsResult =
  | {
      ok: true;
      fields: { engine: AgentEngine; agent_type: AgentKind | null; config: Record<string, unknown> };
      changed: boolean;
    }
  | { ok: false; error: string };

function secretOf(config: unknown): string {
  const value = (config as { webhook_secret?: unknown } | null)?.webhook_secret;
  return typeof value === "string" ? value : "";
}

/**
 * Validate engine / agent_type / config from a create or update body,
 * merged over the existing row. Config is validated against the
 * kind's schema; booking webhook secrets are generated server-side
 * and never cleared by an update that omits them.
 */
export function resolveRuntimeFields(
  body: Record<string, unknown>,
  existing: ExistingRuntimeFields = {},
): RuntimeFieldsResult {
  const touched = "engine" in body || "agent_type" in body || "config" in body;

  const engineRaw = "engine" in body ? body.engine : (existing.engine ?? "legacy");
  if (engineRaw !== "legacy" && engineRaw !== "langgraph") {
    return { ok: false, error: "engine must be 'legacy' or 'langgraph'" };
  }
  const engine: AgentEngine = engineRaw;

  const kindRaw = "agent_type" in body ? body.agent_type : (existing.agent_type ?? null);
  if (kindRaw !== null && kindRaw !== "" && !isAgentKind(kindRaw)) {
    return { ok: false, error: "agent_type is not a supported agent type" };
  }
  const agentType: AgentKind | null = isAgentKind(kindRaw) ? kindRaw : null;

  if (engine === "langgraph" && !agentType) {
    return { ok: false, error: "agent_type is required for the LangGraph engine" };
  }

  const configRaw = "config" in body ? body.config : (existing.config ?? {});
  if (configRaw !== null && (typeof configRaw !== "object" || Array.isArray(configRaw))) {
    return { ok: false, error: "config must be an object" };
  }

  let config: Record<string, unknown> = (configRaw as Record<string, unknown> | null) ?? {};
  if (agentType) {
    const parsed = parseAgentConfig(agentType, config);
    if (!parsed.ok) return { ok: false, error: `config.${parsed.error}` };
    config = parsed.config as Record<string, unknown>;

    if (agentType === "ticket_booking") {
      config.webhook_secret =
        secretOf(configRaw) || secretOf(existing.config) || randomBytes(24).toString("hex");
    }
  }

  return { ok: true, fields: { engine, agent_type: agentType, config }, changed: touched };
}
