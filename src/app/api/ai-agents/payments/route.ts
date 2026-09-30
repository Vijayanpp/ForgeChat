import { NextResponse } from "next/server";

import { requireMember } from "@/lib/agents/reports/api-auth";

const STATUSES = new Set(["pending_review", "verified", "rejected"]);

/** Paid-report payments with their report progress, newest first. */
export async function GET(request: Request) {
  const member = await requireMember("agent");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });

  const status = new URL(request.url).searchParams.get("status");
  let query = member.supabase
    .from("ai_agent_payments")
    .select(
      "id, agent_id, conversation_id, contact_id, status, verified_by, amount_paise, currency, payee, reference, paid_at, reasons, extraction, reviewed_at, created_at, contacts(name, phone)",
    )
    .eq("account_id", member.accountId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && STATUSES.has(status)) query = query.eq("status", status);

  const { data: payments, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (payments ?? []).map((p) => p.id as string);
  const { data: reports } = ids.length
    ? await member.supabase
        .from("ai_agent_reports")
        .select("id, payment_id, status, email_to, emailed_at, notified_at, attempts, last_error, created_at")
        .in("payment_id", ids)
    : { data: [] };
  const byPayment = new Map((reports ?? []).map((r) => [r.payment_id as string, r]));

  return NextResponse.json({
    payments: (payments ?? []).map((p) => ({ ...p, report: byPayment.get(p.id as string) ?? null })),
  });
}
