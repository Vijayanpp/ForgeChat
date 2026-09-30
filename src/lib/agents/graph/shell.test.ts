import { describe, expect, it } from "vitest";

import { defaultAgentConfig } from "../kinds/catalog";
import { runAgentTurn } from "../runtime/run-turn";
import {
  customer,
  emptySession,
  fakeLlm,
  openFacts,
  testAgent,
  testDeps,
} from "../testing/fakes";
import type { AgentKind, ChatTurn, GateFacts, SessionState } from "../types";
import type { AgentTurnInput } from "./shell";

function input(
  kind: AgentKind,
  transcript: ChatTurn[],
  overrides: { config?: Record<string, unknown>; facts?: Partial<GateFacts>; session?: Partial<SessionState> } = {},
): AgentTurnInput {
  return {
    agent: testAgent({ agent_type: kind }),
    kind,
    config: { ...defaultAgentConfig(kind), ...overrides.config } as AgentTurnInput["config"],
    transcript,
    session: emptySession(overrides.session),
    contactName: "Asha",
    gateFacts: openFacts(overrides.facts),
    conversationKey: "conv-1",
  };
}

const inScope = () => ({ intent: "in_scope", needs_human: false, language: "English", reason: "" });

describe("agent graph shell", () => {
  it("stops at the gate without calling any model", async () => {
    const llm = fakeLlm({});
    const result = await runAgentTurn(
      input("customer_service", [customer("hello")], { facts: { lastHumanAt: "2026-09-30T09:50:00Z" } }),
      testDeps(llm),
    );
    expect(result).toMatchObject({ outcome: "skipped", skipReason: "human_active", reply: null });
    expect(llm.calls).toEqual([]);
  });

  it("hands off on a configured keyword without a classifier call", async () => {
    const llm = fakeLlm({});
    const result = await runAgentTurn(
      input("customer_service", [customer("I want a REFUND now")], { config: { handoff_keywords: ["refund"] } }),
      testDeps(llm),
    );
    expect(result.outcome).toBe("handed_off");
    expect(result.session.handedOff).toBe(true);
    expect(result.reply).toMatch(/member of our team/);
    expect(llm.calls).toEqual([]);
  });

  it("hands off complaints detected by the classifier", async () => {
    const llm = fakeLlm({
      classify_turn: () => ({ intent: "complaint", needs_human: false, language: "English", reason: "angry" }),
    });
    const result = await runAgentTurn(input("sales", [customer("This is the worst service ever")]), testDeps(llm));
    expect(result.outcome).toBe("handed_off");
    expect(result.nodePath).toEqual(["gate", "classify:complaint", "handoff"]);
  });

  it("answers in-scope questions and uses the control model for triage", async () => {
    const llm = fakeLlm({
      classify_turn: inScope,
      customer_service_reply: () => ({ reply: "**We ship** in 2 days.", answered_from_knowledge: true }),
    });
    const result = await runAgentTurn(
      input("customer_service", [customer("How long is shipping?")], {
        config: { knowledge_base: "Shipping takes 2 days." },
      }),
      testDeps(llm),
    );
    expect(result.outcome).toBe("replied");
    expect(result.reply).toBe("*We ship* in 2 days.");
    expect(llm.calls[0]).toMatchObject({ name: "classify_turn", model: "control-model" });
    expect(llm.calls[1]).toMatchObject({ name: "customer_service_reply", model: "reply-model" });
    expect(result.usage.promptTokens).toBe(40);
  });

  it("hands off when the knowledge base does not cover the question", async () => {
    const llm = fakeLlm({
      classify_turn: inScope,
      customer_service_reply: () => ({ reply: "Let me check.", answered_from_knowledge: false }),
    });
    const result = await runAgentTurn(
      input("customer_service", [customer("Do you ship to Mars?")], { config: { knowledge_base: "Shipping: India only." } }),
      testDeps(llm),
    );
    expect(result.outcome).toBe("handed_off");
  });

  it("hands off before drafting when retrieval finds no evidence in a large knowledge base", async () => {
    const llm = fakeLlm({
      classify_turn: inScope,
      decompose_question: () => ({
        needs_retrieval: true,
        standalone_question: "Do you sell cars?",
        requires_decomposition: false,
        reasoning: "",
        sub_questions: [],
      }),
      generate_search_queries: () => ({ original_question: "", queries: [{ id: "1", query: "automobile", angle: "" }] }),
    });
    const knowledge_base = "## Returns\nProducts may be returned within 7 days.\n\n" + "Lorem ipsum dolor. ".repeat(400);
    const result = await runAgentTurn(
      input("customer_service", [customer("Do you sell cars?")], { config: { knowledge_base } }),
      testDeps(llm),
    );
    expect(result.outcome).toBe("handed_off");
    expect(result.nodePath).toContain("cs:no_evidence");
    expect(llm.calls.map((c) => c.name)).not.toContain("customer_service_reply");
  });

  it("rewrites a reply that discloses being an AI", async () => {
    const llm = fakeLlm(
      {
        classify_turn: inScope,
        customer_service_reply: () => ({ reply: "As an AI language model, I think yes.", answered_from_knowledge: true }),
      },
      () => "Yes, we can do that for you!",
    );
    const result = await runAgentTurn(input("customer_service", [customer("Can you gift wrap?")]), testDeps(llm));
    expect(result.reply).toBe("Yes, we can do that for you!");
    expect(result.nodePath).toContain("guard:rewritten");
  });

  it("sends palm photo turns to the vision model and tracks the upsell", async () => {
    const llm = fakeLlm({}, () => "Your heart line curves upward…");
    const photo = customer("[Customer sent a photo]", undefined, { imageDataUrls: ["data:image/jpeg;base64,AAAA"] });
    const result = await runAgentTurn(
      input("palm_reading", [photo], { config: { upsell_after_readings: 0 } }),
      testDeps(llm),
    );
    expect(result.outcome).toBe("replied");
    expect(llm.calls).toEqual([{ kind: "chat", model: "vision-model" }]);
    expect(result.session.slots).toMatchObject({ readings_given: 1, offer_made: true });
    expect(result.session.stage).toBe("offer_made");
  });

  it("accumulates sales qualification across the session", async () => {
    const llm = fakeLlm({
      classify_turn: inScope,
      sales_qualification: () => ({
        updates: [{ key: "budget", value: "₹50k" }],
        summary: "Wants CRM, budget 50k.",
      }),
    });
    const result = await runAgentTurn(
      input("sales", [customer("Our budget is 50k")], {
        session: { slots: { qualification: { need: "CRM for 5 agents" } } },
      }),
      testDeps(llm),
    );
    expect(result.session.slots).toMatchObject({ qualification: { need: "CRM for 5 agents", budget: "₹50k" } });
    expect(result.session.summary).toBe("Wants CRM, budget 50k.");
    expect(result.session.stage).toBe("qualifying");
  });
});
