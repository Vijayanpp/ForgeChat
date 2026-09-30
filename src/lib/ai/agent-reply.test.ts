import { beforeEach, describe, expect, it, vi } from "vitest";

const agentRow = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/automations/admin-client", () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: agentRow.current, error: null });
    q.then = (resolve: (v: unknown) => void) =>
      resolve({ data: [{ sender_type: "customer", content_text: "hi", content_type: "text", media_url: null }], error: null });
    return q;
  };
  return { supabaseAdmin: () => ({ from: () => chain() }) };
});

const sendText = vi.hoisted(() => vi.fn(async () => ({ whatsapp_message_id: "wamid.1" })));
vi.mock("@/lib/automations/meta-send", () => ({ engineSendText: sendText }));

const generate = vi.hoisted(() => vi.fn(async () => "legacy reply"));
vi.mock("@/lib/ai/client", () => ({ generateAgentReply: generate }));

const enqueue = vi.hoisted(() => vi.fn(async () => ({ jobId: "job-1", outcome: "enqueued" })));
vi.mock("@/lib/agents", () => ({
  enqueueAgentTurn: enqueue,
  usesLangGraphRuntime: (a: { engine?: string }) => a.engine === "langgraph",
}));

import { executeAgentReply } from "./agent-reply";

const args = {
  accountId: "acct-1",
  userId: "user-1",
  agentId: "agent-1",
  conversationId: "conv-1",
  contactId: "contact-1",
};

const baseAgent = {
  id: "agent-1",
  account_id: "acct-1",
  name: "Helper",
  system_prompt: "Be nice",
  model: "gpt-4o",
  temperature: 0.7,
  context_message_limit: 10,
  status: "active",
};

describe("executeAgentReply engine branch", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test";
  });

  it("keeps legacy agents on the single-prompt path", async () => {
    agentRow.current = { ...baseAgent, engine: "legacy" };
    const result = await executeAgentReply(args);
    expect(result).toEqual({ kind: "sent", whatsapp_message_id: "wamid.1", agentName: "Helper" });
    expect(generate).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("treats rows without an engine column as legacy", async () => {
    agentRow.current = { ...baseAgent };
    const result = await executeAgentReply(args);
    expect(result.kind).toBe("sent");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues LangGraph agents instead of replying inline", async () => {
    agentRow.current = { ...baseAgent, engine: "langgraph", agent_type: "sales" };
    const result = await executeAgentReply(args);
    expect(result).toEqual({ kind: "queued", jobId: "job-1", enqueue: "enqueued", agentName: "Helper" });
    expect(generate).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
