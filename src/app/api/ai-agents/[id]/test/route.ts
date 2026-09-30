import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAgentReply, type ChatMessage } from "@/lib/ai/client";
import { parseAgentConfig } from "@/lib/agents/kinds/catalog";
import { dryRunAgentDeps } from "@/lib/agents/runtime/deps";
import { runAgentTurn } from "@/lib/agents/runtime/run-turn";
import { freshSession } from "@/lib/agents/runtime/session-store";
import { isAgentKind, type ChatTurn, type RuntimeAgent, type SessionState } from "@/lib/agents/types";

const MAX_HISTORY = 20;
const MAX_TEXT = 2000;

interface TestBody {
  message?: unknown;
  history?: unknown;
  session?: unknown;
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .slice(-MAX_HISTORY)
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .map((m, i, all) => ({
      role: m.role,
      content: m.content.slice(0, MAX_TEXT),
      sender: m.role === "user" ? ("customer" as const) : ("bot" as const),
      at: new Date(now - (all.length - i) * 1000).toISOString(),
    }));
}

function parseSession(raw: unknown): SessionState {
  const base = freshSession();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<SessionState>;
  return {
    stage: typeof s.stage === "string" ? s.stage.slice(0, 60) : base.stage,
    slots: s.slots && typeof s.slots === "object" && !Array.isArray(s.slots) ? s.slots : {},
    summary: typeof s.summary === "string" ? s.summary.slice(0, 2000) : null,
    handedOff: false,
    pausedUntil: null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "AI is not configured on this server." },
      { status: 503 },
    );
  }

  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json(
      { error: "Your profile is not linked to an account." },
      { status: 403 },
    );
  }

  const { data: agent, error: agentErr } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as TestBody;
  const sampleMessage =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim().slice(0, MAX_TEXT)
      : "Hi, can you help me?";

  if (agent.engine === "langgraph" && isAgentKind(agent.agent_type)) {
    const parsed = parseAgentConfig(agent.agent_type, agent.config);
    if (!parsed.ok) {
      return NextResponse.json({ error: `Invalid agent config: ${parsed.error}` }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const transcript: ChatTurn[] = [
      ...parseHistory(body.history),
      { role: "user", content: sampleMessage, sender: "customer", at: nowIso },
    ];
    const session = parseSession(body.session);

    try {
      const result = await runAgentTurn(
        {
          agent: agent as RuntimeAgent,
          kind: agent.agent_type,
          config: parsed.config,
          transcript,
          session,
          contactName: "Test Customer",
          gateFacts: {
            conversationStatus: "open",
            lastCustomerAt: nowIso,
            lastHumanAt: null,
            latestSender: "customer",
            handedOff: false,
            pausedUntil: null,
            tokensUsedThisMonth: 0,
          },
          conversationKey: `test:${agent.id}:${user.id}`,
        },
        dryRunAgentDeps(),
        { tags: ["dry-run"] },
      );
      return NextResponse.json({
        reply: result.reply,
        outcome: result.outcome,
        nodePath: result.nodePath,
        session: result.session,
        usage: result.usage,
      });
    } catch (err) {
      console.error("[ai-agents/test] graph", err);
      return NextResponse.json({ error: "Failed to generate test reply" }, { status: 500 });
    }
  }

  const messages: ChatMessage[] = [{ role: "user", content: sampleMessage }];

  try {
    const reply = await generateAgentReply(
      messages,
      {
        system_prompt: agent.system_prompt as string,
        model: agent.model as string,
        temperature: Number(agent.temperature),
      },
      "Test Customer",
    );
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[ai-agents/test]", err);
    return NextResponse.json(
      { error: "Failed to generate test reply" },
      { status: 500 },
    );
  }
}
