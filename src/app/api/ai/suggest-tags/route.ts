import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestTags } from "@/lib/ai/client";
import type { ChatMessage } from "@/lib/ai/client";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ tagIds: [] }, { status: 200 });
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

    // Verify the conversation belongs to this account and get contact name
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, contact:contacts(id, name)")
      .eq("id", conversationId)
      .eq("account_id", accountId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const contact = conversation.contact as unknown as { id: string; name?: string } | null;
    const contactName = contact?.name ?? "";

    // Fetch account tags in parallel with last 15 messages
    const [tagsRes, msgsRes] = await Promise.all([
      supabase
        .from("tags")
        .select("id, name")
        .eq("account_id", accountId)
        .order("name", { ascending: true }),
      supabase
        .from("messages")
        .select("sender_type, content_text")
        .eq("conversation_id", conversationId)
        .not("content_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    const availableTags = (tagsRes.data ?? []) as { id: string; name: string }[];

    if (availableTags.length === 0) {
      return NextResponse.json({ tagIds: [] });
    }

    if (!msgsRes.data || msgsRes.data.length === 0) {
      return NextResponse.json({ tagIds: [] });
    }

    // Reverse to chronological order and map to ChatMessage roles
    const messages: ChatMessage[] = msgsRes.data
      .reverse()
      .map((row) => ({
        role: row.sender_type === "customer" ? "user" : "assistant",
        content: row.content_text as string,
      }));

    const tagIds = await suggestTags(messages, contactName, availableTags);

    return NextResponse.json({ tagIds });
  } catch (error) {
    console.error("[ai/suggest-tags] error:", error);
    return NextResponse.json(
      { error: "Failed to suggest tags" },
      { status: 500 },
    );
  }
}
