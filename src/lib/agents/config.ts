function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function floatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export interface AgentRuntimeConfig {
  /** Kill switch: when false, langgraph agents fall back to the legacy reply path. */
  enabled: boolean;
  debounceMs: number;
  humanCooldownMinutes: number;
  /** 0 disables the budget gate. */
  monthlyTokenBudget: number;
  controlModel: string;
  visionModel: string;
  turnTimeoutMs: number;
  maxAttempts: number;
  dispatch: "inline" | "cron";
  traceSampleRate: number;
}

export function agentRuntimeConfig(): AgentRuntimeConfig {
  return {
    enabled: process.env.AI_AGENTS_LANGGRAPH_ENABLED !== "false",
    debounceMs: intEnv("AI_AGENT_DEBOUNCE_MS", 4000, 0, 60_000),
    humanCooldownMinutes: intEnv("AI_AGENT_HUMAN_COOLDOWN_MIN", 30, 0, 24 * 60),
    monthlyTokenBudget: intEnv("AI_AGENT_MONTHLY_TOKEN_BUDGET", 0, 0, Number.MAX_SAFE_INTEGER),
    controlModel: process.env.AI_AGENT_CONTROL_MODEL || "gpt-4o-mini",
    visionModel: process.env.AI_AGENT_VISION_MODEL || "gpt-4o",
    turnTimeoutMs: intEnv("AI_AGENT_TURN_TIMEOUT_MS", 25_000, 5_000, 120_000),
    maxAttempts: intEnv("AI_AGENT_MAX_ATTEMPTS", 3, 1, 10),
    dispatch: process.env.AI_AGENT_DISPATCH === "cron" ? "cron" : "inline",
    traceSampleRate: floatEnv("AI_AGENT_TRACE_SAMPLE_RATE", 1, 0, 1),
  };
}
