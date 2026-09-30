import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";

import type { ChatTurn } from "../types";

/** Only the most recent customer photos are sent to the vision model. */
const MAX_IMAGES = 2;

interface MessageRow {
  id: string;
  sender_type: string;
  content_text: string | null;
  content_type: string;
  media_url: string | null;
  created_at: string;
}

export type ImageDownloader = (accountId: string, mediaUrl: string) => Promise<string | null>;

function senderOf(value: string): ChatTurn["sender"] {
  if (value === "customer" || value === "agent" || value === "bot") return value;
  return "bot";
}

/**
 * Rebuild the transcript from `messages`, the single source of truth
 * (human inbox replies included). Oldest first.
 */
export async function loadTranscript(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    limit: number;
    downloadImage?: ImageDownloader;
  },
): Promise<ChatTurn[]> {
  const { data, error } = await db
    .from("messages")
    .select("id, sender_type, content_text, content_type, media_url, created_at")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: false })
    .limit(args.limit + 10);

  if (error) throw new Error(`failed to load transcript: ${error.message}`);

  const rows = ((data ?? []) as MessageRow[])
    .filter(
      (row) =>
        (row.content_text && row.content_text.trim()) ||
        (row.content_type === "image" && row.media_url),
    )
    .slice(0, args.limit);

  let imagesLeft = MAX_IMAGES;
  const newestFirst: ChatTurn[] = [];

  for (const row of rows) {
    const sender = senderOf(row.sender_type);
    let imageDataUrls: string[] | undefined;

    if (
      sender === "customer" &&
      row.content_type === "image" &&
      row.media_url &&
      imagesLeft > 0 &&
      args.downloadImage
    ) {
      const dataUrl = await args.downloadImage(args.accountId, row.media_url);
      if (dataUrl) {
        imageDataUrls = [dataUrl];
        imagesLeft -= 1;
      }
    }

    const text =
      row.content_text?.trim() ||
      (row.content_type === "image" ? "[Customer sent a photo]" : "");

    newestFirst.push({
      role: sender === "customer" ? "user" : "assistant",
      content: text,
      sender,
      at: row.created_at,
      messageId: row.id,
      ...(row.content_type === "image" && row.media_url ? { mediaUrl: row.media_url } : {}),
      ...(imageDataUrls ? { imageDataUrls } : {}),
    });
  }

  return newestFirst.reverse();
}

export function hasImages(turns: ChatTurn[]): boolean {
  return turns.some((t) => (t.imageDataUrls?.length ?? 0) > 0);
}

/** Images attached to the customer's latest burst of messages. */
export function latestCustomerImages(turns: ChatTurn[]): string[] {
  const images: string[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.sender !== "customer") break;
    if (turn.imageDataUrls) images.push(...turn.imageDataUrls);
  }
  return images;
}

/** The customer's latest burst of messages, joined. */
export function latestCustomerText(turns: ChatTurn[]): string {
  const parts: string[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.sender !== "customer") break;
    parts.unshift(turn.content);
  }
  return parts.join("\n").trim();
}

export function toLangChainMessages(
  turns: ChatTurn[],
  opts: { includeImages: boolean } = { includeImages: true },
): BaseMessage[] {
  return turns.map((turn) => {
    if (turn.role === "assistant") return new AIMessage(turn.content);
    if (!opts.includeImages || !turn.imageDataUrls?.length) {
      return new HumanMessage(turn.content);
    }
    const content: MessageContent = [
      { type: "text", text: turn.content || "[Customer sent a photo]" },
      ...turn.imageDataUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url, detail: "high" as const },
      })),
    ];
    return new HumanMessage({ content });
  });
}

/** Plain-text transcript for control-model prompts (no images). */
export function transcriptToText(turns: ChatTurn[], maxTurns = 12): string {
  return turns
    .slice(-maxTurns)
    .map((t) => {
      const who = t.sender === "customer" ? "Customer" : t.sender === "agent" ? "Staff" : "Assistant";
      return `${who}: ${t.content}`;
    })
    .join("\n");
}
