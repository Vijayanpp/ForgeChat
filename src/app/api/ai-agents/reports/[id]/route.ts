import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireMember } from "@/lib/agents/reports/api-auth";
import { scheduleReportDrain } from "@/lib/agents/reports/runtime";

/** Retry a failed report. Finished steps (generation, email, WhatsApp) are not repeated. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember("admin");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });

  const { data, error } = await supabaseAdmin()
    .from("ai_agent_reports")
    .update({ status: "pending", attempts: 0, run_after: new Date().toISOString(), started_at: null, last_error: null })
    .eq("id", id)
    .eq("account_id", member.accountId)
    .eq("status", "failed")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Only failed reports can be retried" }, { status: 409 });

  scheduleReportDrain();
  return NextResponse.json({ success: true });
}
