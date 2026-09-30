export const AGENT_KINDS = [
  "customer_service",
  "palm_reading",
  "ticket_booking",
  "sales",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export type AgentEngine = "legacy" | "langgraph";

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

/** `ai_agents` row as the runtime sees it. */
export interface RuntimeAgent {
  id: string;
  account_id: string;
  name: string;
  system_prompt: string;
  model: string;
  temperature: number;
  context_message_limit: number;
  status: string;
  engine: AgentEngine;
  agent_type: AgentKind | null;
  config: unknown;
  config_version: number;
}

/** One transcript entry rebuilt from `messages`. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  imageDataUrls?: string[];
  sender: "customer" | "agent" | "bot";
  at: string;
  messageId?: string;
  mediaUrl?: string;
}

export interface SessionState {
  stage: string;
  slots: Record<string, unknown>;
  summary: string | null;
  handedOff: boolean;
  pausedUntil: string | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

/** Facts the gate node needs; gathered by the worker from the DB. */
export interface GateFacts {
  conversationStatus: string | null;
  lastCustomerAt: string | null;
  lastHumanAt: string | null;
  latestSender: ChatTurn["sender"] | null;
  handedOff: boolean;
  pausedUntil: string | null;
  tokensUsedThisMonth: number;
}

export type SkipReason =
  | "conversation_closed"
  | "no_customer_message"
  | "already_answered"
  | "human_active"
  | "handed_off"
  | "paused"
  | "budget_exceeded"
  | "outside_24h_window";

export type TurnOutcome = "replied" | "handed_off" | "skipped" | "failed";

export interface TurnResult {
  outcome: TurnOutcome;
  reply: string | null;
  skipReason: SkipReason | null;
  session: SessionState;
  nodePath: string[];
  usage: Usage;
  langsmithRunId: string | null;
}
