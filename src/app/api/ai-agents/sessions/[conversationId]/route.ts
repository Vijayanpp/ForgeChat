import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { createClient } from "@/lib/supabase/server";

type Action = "pause" | "resume" | "reset";

const MAX_PAUSE_MINUTES = 7 * 24 * 60;

async function resolveMember(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  return accountId ? { accountId } : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const member = await resolveMember(supabase);
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("ai_agent_sessions")
    .select("agent_id, stage, state, handed_off, paused_until, updated_at")
    .eq("conversation_id", conversationId)
    .eq("account_id", member.accountId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data ?? null });
}

/**
 * Human control over the AI in one conversation. Any account member
 * who can reply to customers (agent role and above) may use it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const member = await resolveMember(supabase);
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { action?: Action; minutes?: number } | null;
  const action = body?.action;
  if (action !== "pause" && action !== "resume" && action !== "reset") {
    return NextResponse.json({ error: "action must be pause, resume or reset" }, { status: 400 });
  }

  // RLS check that the caller may act on this conversation.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("account_id", member.accountId)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const { data: canWrite } = await supabase.rpc("is_account_member", {
    target_account_id: member.accountId,
    min_role: "agent",
  });
  if (canWrite !== true) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from("ai_agent_sessions")
    .select("id, version")
    .eq("conversation_id", conversationId)
    .eq("account_id", member.accountId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "No AI session for this conversation" }, { status: 404 });

  const minutes = Math.max(1, Math.min(MAX_PAUSE_MINUTES, Math.round(Number(body?.minutes) || 24 * 60)));
  const update =
    action === "pause"
      ? { paused_until: new Date(Date.now() + minutes * 60_000).toISOString() }
      : action === "resume"
        ? { paused_until: null, handed_off: false }
        : { paused_until: null, handed_off: false, stage: "new", state: {} };

  const { error } = await admin
    .from("ai_agent_sessions")
    .update({ ...update, version: (session.version as number) + 1 })
    .eq("id", session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
