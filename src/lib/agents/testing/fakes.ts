import type { BaseMessage } from "@langchain/core/messages";

import type { AgentRuntimeConfig } from "../config";
import type { AgentGraphDeps } from "../graph/shell";
import type { SpecialistServices } from "../kinds/contract";
import type { LlmToolkit } from "../llm/toolkit";
import { dryRunPaymentService } from "../reports/service";
import type { BookingClient } from "../tools/booking";
import type { ChatTurn, GateFacts, RuntimeAgent, SessionState } from "../types";

export type StructuredHandler = (messages: BaseMessage[]) => Record<string, unknown>;
export type ChatHandler = (messages: BaseMessage[]) => string;

export interface FakeLlm extends LlmToolkit {
  calls: Array<{ kind: "chat" | "structured"; name?: string; model: string }>;
}

/** Scripted model: structured outputs by schema name, chat by handler. */
export function fakeLlm(
  structured: Record<string, StructuredHandler>,
  chat: ChatHandler = () => "Sure, happy to help!",
): FakeLlm {
  const calls: FakeLlm["calls"] = [];
  return {
    calls,
    async chat(spec, messages) {
      calls.push({ kind: "chat", model: spec.model });
      return { text: chat(messages), usage: { promptTokens: 10, completionTokens: 5 } };
    },
    async structured(spec, schema, name, messages) {
      calls.push({ kind: "structured", name, model: spec.model });
      const handler = structured[name];
      if (!handler) throw new Error(`no fake for structured output "${name}"`);
      return { data: schema.parse(handler(messages)), usage: { promptTokens: 20, completionTokens: 5 } };
    },
  };
}

export const testRuntime: AgentRuntimeConfig = {
  enabled: true,
  debounceMs: 0,
  humanCooldownMinutes: 30,
  monthlyTokenBudget: 0,
  controlModel: "control-model",
  visionModel: "vision-model",
  turnTimeoutMs: 20_000,
  maxAttempts: 3,
  dispatch: "cron",
  traceSampleRate: 0,
};

export function recordingBooking(overrides: Partial<BookingClient> = {}) {
  const calls: Array<{ op: "availability" | "book"; details: Record<string, unknown> }> = [];
  const client: BookingClient = {
    async checkAvailability(_config, details) {
      calls.push({ op: "availability", details });
      return { available: true };
    },
    async createBooking(_config, details) {
      calls.push({ op: "book", details });
      return { success: true, reference: "BK-42" };
    },
    ...overrides,
  };
  return { client, calls };
}

export function testServices(overrides: Partial<SpecialistServices> = {}): SpecialistServices {
  return {
    booking: recordingBooking().client,
    payments: dryRunPaymentService,
    reports: {
      async resolvePlace(place) {
        return { displayName: `${place} (resolved)`, latitude: 29.13, longitude: 77.02, timezone: "Asia/Kolkata" };
      },
      async requestReport() {
        return { reportId: "report-1", created: true };
      },
    },
    ...overrides,
  };
}

export function testDeps(llm: LlmToolkit, booking: BookingClient = recordingBooking().client): AgentGraphDeps {
  return { llm, services: testServices({ booking }), runtime: testRuntime, now: () => new Date("2026-09-30T10:00:00Z") };
}

export function testAgent(overrides: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    id: "agent-1",
    account_id: "acct-1",
    name: "Test Agent",
    system_prompt: "You are helpful.",
    model: "reply-model",
    temperature: 0.5,
    context_message_limit: 15,
    status: "active",
    engine: "langgraph",
    agent_type: "customer_service",
    config: {},
    config_version: 1,
    ...overrides,
  };
}

export function customer(content: string, at = "2026-09-30T09:59:00Z", extra: Partial<ChatTurn> = {}): ChatTurn {
  return { role: "user", content, sender: "customer", at, ...extra };
}

export function bot(content: string, at = "2026-09-30T09:58:00Z"): ChatTurn {
  return { role: "assistant", content, sender: "bot", at };
}

export function openFacts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    conversationStatus: "open",
    lastCustomerAt: "2026-09-30T09:59:00Z",
    lastHumanAt: null,
    latestSender: "customer",
    handedOff: false,
    pausedUntil: null,
    tokensUsedThisMonth: 0,
    ...overrides,
  };
}

export function emptySession(overrides: Partial<SessionState> = {}): SessionState {
  return { stage: "new", slots: {}, summary: null, handedOff: false, pausedUntil: null, ...overrides };
}

export function lastHumanText(messages: BaseMessage[]): string {
  const human = [...messages].reverse().find((m) => m.getType() === "human");
  return typeof human?.content === "string" ? human.content : "";
}

export function systemText(messages: BaseMessage[]): string {
  const sys = messages.find((m) => m.getType() === "system");
  return typeof sys?.content === "string" ? sys.content : "";
}
