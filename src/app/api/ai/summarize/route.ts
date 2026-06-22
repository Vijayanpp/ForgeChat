import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { summarizeConversation } from "@/lib/ai/client";
import type { ChatMessage } from "@/lib/ai/client";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ summary: "" }, { status: 200 });
  }

  try {
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

    const body = await request.json();
    const { conversationId } = body as { conversationId?: string };

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    // Verify conversation belongs to this account and fetch contact name
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, contact:contacts(name)")
      .eq("id", conversationId)
      .eq("account_id", accountId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const contactName =
      (conversation.contact as unknown as { name?: string } | null)?.name ?? "";

    // Fetch last 30 messages (newest-first → reverse to chronological)
    const { data: rows, error: msgError } = await supabase
      .from("messages")
      .select("sender_type, content_text")
      .eq("conversation_id", conversationId)
      .not("content_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(30);

    if (msgError) {
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 },
      );
    }

    if (!rows || rows.length < 3) {
      return NextResponse.json({ summary: "" });
    }

    const messages: ChatMessage[] = rows
      .reverse()
      .map((row) => ({
        role: row.sender_type === "customer" ? "user" : "assistant",
        content: row.content_text as string,
      }));

    const summary = await summarizeConversation(messages, contactName);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[ai/summarize] error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
