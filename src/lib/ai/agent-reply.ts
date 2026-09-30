import { generateAgentReply, type ChatMessage } from "@/lib/ai/client";
import { downloadWhatsAppImageDataUrl } from "@/lib/ai/resolve-message-media";
import { enqueueAgentTurn, usesLangGraphRuntime } from "@/lib/agents";
import { withPalmPaymentPrompt, withPalmPaymentReply } from "@/lib/agents/kinds/palm-offer";
import { engineSendText } from "@/lib/automations/meta-send";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export interface AiAgentRow {
  id: string;
  account_id: string;
  name: string;
  system_prompt: string;
  model: string;
  temperature: number;
  context_message_limit: number;
  status: string;
  engine?: string | null;
  agent_type?: string | null;
  config?: unknown;
}

export type AgentReplyOutcome =
  | { kind: "sent"; whatsapp_message_id: string; agentName: string }
  | { kind: "queued"; jobId: string; enqueue: string; agentName: string };

interface MessageRow {
  sender_type: string;
  content_text: string | null;
  content_type: string;
  media_url: string | null;
}

export async function fetchConversationContext(
  conversationId: string,
  accountId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from("messages")
    .select("sender_type, content_text, content_type, media_url")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit + 15);

  if (error) throw new Error(`failed to fetch messages: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const meaningful = (rows as MessageRow[]).filter(
    (row) =>
      (row.content_text && row.content_text.trim()) ||
      (row.content_type === "image" && row.media_url),
  );

  const slice = meaningful.slice(0, limit).reverse();

  const messages: ChatMessage[] = [];
  for (const row of slice) {
    const role = row.sender_type === "customer" ? ("user" as const) : ("assistant" as const);
    let imageDataUrls: string[] | undefined;

    if (
      role === "user" &&
      row.content_type === "image" &&
      row.media_url
    ) {
      const dataUrl = await downloadWhatsAppImageDataUrl(
        accountId,
        row.media_url,
      );
      if (dataUrl) imageDataUrls = [dataUrl];
    }

    const text =
      row.content_text?.trim() ||
      (imageDataUrls
        ? ""
        : row.content_type === "image"
          ? "[Customer sent a photo]"
          : "");

    if (!text && !imageDataUrls?.length) continue;

    messages.push({
      role,
      content: text,
      ...(imageDataUrls ? { imageDataUrls } : {}),
    });
  }

  return messages;
}

export async function executeAgentReply(args: {
  accountId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  contactId: string;
}): Promise<AgentReplyOutcome> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const db = supabaseAdmin();

  const { data: agent, error: agentErr } = await db
    .from("ai_agents")
    .select("*")
    .eq("id", args.agentId)
    .eq("account_id", args.accountId)
    .maybeSingle();

  if (agentErr || !agent) {
    throw new Error("AI agent not found for this account");
  }

  const typed = agent as AiAgentRow;
  if (typed.status !== "active") {
    throw new Error(`AI agent "${typed.name}" is not active`);
  }

  if (usesLangGraphRuntime(typed)) {
    const { jobId, outcome } = await enqueueAgentTurn({
      accountId: args.accountId,
      userId: args.userId,
      agentId: args.agentId,
      conversationId: args.conversationId,
      contactId: args.contactId,
    });
    return { kind: "queued", jobId, enqueue: outcome, agentName: typed.name };
  }

  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select("name")
    .eq("id", args.contactId)
    .eq("account_id", args.accountId)
    .maybeSingle();

  if (contactErr) {
    throw new Error(`contact lookup failed: ${contactErr.message}`);
  }

  const contactName = (contact?.name as string | undefined) ?? "";
  const messages = await fetchConversationContext(
    args.conversationId,
    args.accountId,
    typed.context_message_limit,
  );

  if (messages.length === 0) {
    throw new Error("no messages to generate a reply from");
  }

  const replyText = withPalmPaymentReply(
    await generateAgentReply(
      messages,
      {
        system_prompt: withPalmPaymentPrompt(typed.system_prompt, typed),
        model: typed.model,
        temperature: Number(typed.temperature),
      },
      contactName,
    ),
    typed,
    messages.at(-1)?.content ?? "",
  );

  const { whatsapp_message_id } = await engineSendText({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    text: replyText,
    aiAgentId: args.agentId,
  });

  return { kind: "sent", whatsapp_message_id, agentName: typed.name };
}
