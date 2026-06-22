import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreContact } from "@/lib/ai/client";
import type { ChatMessage } from "@/lib/ai/client";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "AI scoring is not configured on this server." },
      { status: 503 },
    );
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
    const { contactId } = body as { contactId?: string };

    if (!contactId) {
      return NextResponse.json(
        { error: "contactId is required" },
        { status: 400 },
      );
    }

    // Verify contact belongs to this account
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, name")
      .eq("id", contactId)
      .eq("account_id", accountId)
      .single();

    if (contactError || !contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const contactName = (contact as { name?: string | null }).name ?? "";

    // Fetch all conversations for this contact, and their messages
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(5);

    const convIds = (conversations ?? []).map((c: { id: string }) => c.id);

    if (convIds.length === 0) {
      return NextResponse.json(
        { error: "No conversation history to score" },
        { status: 422 },
      );
    }

    // Fetch last 40 messages across all conversations for this contact
    const { data: rows, error: msgError } = await supabase
      .from("messages")
      .select("sender_type, content_text, created_at")
      .in("conversation_id", convIds)
      .not("content_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(40);

    if (msgError) {
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 },
      );
    }

    if (!rows || rows.length < 2) {
      return NextResponse.json(
        { error: "Not enough conversation history to score this lead" },
        { status: 422 },
      );
    }

    const messages: ChatMessage[] = (rows as { sender_type: string; content_text: string }[])
      .reverse()
      .map((row) => ({
        role: row.sender_type === "customer" ? "user" : "assistant",
        content: row.content_text,
      }));

    const result = await scoreContact(messages, contactName);

    // Persist the score back to contacts
    await supabase
      .from("contacts")
      .update({
        lead_score: result.score,
        lead_score_updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[ai/score-lead] error:", error);
    return NextResponse.json(
      { error: "Failed to score lead" },
      { status: 500 },
    );
  }
}
