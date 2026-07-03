// ============================================================
// DELETE /api/whatsapp/messages/[id]
//
// Admin+. Permanently deletes a single message from our own
// database — this is a CRM-only action. WhatsApp's Cloud API has
// no endpoint to recall/unsend a message already delivered to a
// customer's device, so there is no corresponding Meta API call
// here; the message still exists on the customer's phone.
//
// Hard delete (no "deleted" placeholder row) — reactions on the
// message cascade away (`message_reactions.message_id ON DELETE
// CASCADE`), and any reply that pointed at it has
// `reply_to_message_id` set to NULL automatically (`ON DELETE SET
// NULL`, migration 009). RLS (`messages_delete`, migration 028)
// already restricts this to admin+ members of the message's
// account; the `requireRole` check below is defense-in-depth /
// gives a clean 403 instead of a 0-row delete.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:messageDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // RLS (messages_delete, admin+) scopes this to messages in the
    // caller's account — a cross-account id or an already-deleted
    // id both come back as a 0-row delete, handled below as 404.
    const { data: deleted, error: deleteError } = await ctx.supabase
      .from("messages")
      .delete()
      .eq("id", id)
      .select("conversation_id")
      .maybeSingle();

    if (deleteError) {
      console.error(
        "[DELETE /api/whatsapp/messages/[id]] delete error:",
        deleteError,
      );
      return NextResponse.json(
        { error: "Failed to delete message" },
        { status: 500 },
      );
    }

    if (!deleted) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 },
      );
    }

    // Repair the denormalized conversation preview if the message we
    // just removed was the most recent one — nothing else recomputes
    // these columns on delete (they're only ever written forward, by
    // the send route and the inbound webhook).
    const { data: latest } = await ctx.supabase
      .from("messages")
      .select("content_text, content_type, created_at")
      .eq("conversation_id", deleted.conversation_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: previewError } = await ctx.supabase
      .from("conversations")
      .update({
        last_message_text: latest
          ? (latest.content_text ?? `[${latest.content_type}]`)
          : null,
        last_message_at: latest?.created_at ?? null,
      })
      .eq("id", deleted.conversation_id);

    if (previewError) {
      // Non-fatal — the message itself is already gone. Log and move
      // on rather than leaving the caller with a 500 for a delete
      // that actually succeeded.
      console.error(
        "[DELETE /api/whatsapp/messages/[id]] conversation preview update failed:",
        previewError,
      );
    }

    return NextResponse.json({ ok: true, conversationId: deleted.conversation_id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
