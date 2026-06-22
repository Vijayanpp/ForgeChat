import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAgentReply, type ChatMessage } from "@/lib/ai/client";

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

  const body = await request.json().catch(() => ({}));
  const sampleMessage =
    typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message.trim()
      : "Hi, can you help me?";

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
