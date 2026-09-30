import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireMember } from "@/lib/agents/reports/api-auth";
import { ReviewError, reviewPayment } from "@/lib/agents/reports/review";

/** Approve or reject a payment screenshot the bot sent for review. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember("agent");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });

  const body = (await request.json().catch(() => null)) as { action?: string; reason?: string } | null;
  if (body?.action !== "approve" && body?.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  try {
    const result = await reviewPayment(supabaseAdmin(), {
      accountId: member.accountId,
      reviewerId: member.user.id,
      paymentId: id,
      action: body.action,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReviewError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agents/payments] review failed", id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
