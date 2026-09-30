import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireMember } from "@/lib/agents/reports/api-auth";
import { encrypt } from "@/lib/whatsapp/encryption";

type Params = { params: Promise<{ id: string }> };

async function ownedAgent(accountId: string, agentId: string) {
  const { data } = await supabaseAdmin()
    .from("ai_agents")
    .select("id")
    .eq("id", agentId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data);
}

/** Whether Razorpay API verification is set up. The secret is never returned. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const member = await requireMember("admin");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });
  if (!(await ownedAgent(member.accountId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data } = await supabaseAdmin()
    .from("ai_agent_secrets")
    .select("razorpay_key_id, razorpay_key_secret_enc")
    .eq("agent_id", id)
    .maybeSingle();
  return NextResponse.json({
    configured: Boolean(data?.razorpay_key_id && data.razorpay_key_secret_enc),
    keyId: (data?.razorpay_key_id as string | undefined) ?? null,
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const member = await requireMember("admin");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });
  if (!(await ownedAgent(member.accountId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { keyId?: string; keySecret?: string } | null;
  const keyId = body?.keyId?.trim() ?? "";
  const keySecret = body?.keySecret?.trim() ?? "";
  if (!/^rzp_(live|test)_[A-Za-z0-9]{8,32}$/.test(keyId)) {
    return NextResponse.json({ error: "Key ID should look like rzp_live_…" }, { status: 400 });
  }
  if (keySecret.length < 10 || keySecret.length > 100) {
    return NextResponse.json({ error: "Key secret looks invalid" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("ai_agent_secrets")
    .upsert({
      agent_id: id,
      account_id: member.accountId,
      razorpay_key_id: keyId,
      razorpay_key_secret_enc: encrypt(keySecret),
      updated_at: new Date().toISOString(),
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: true, keyId });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const member = await requireMember("admin");
  if ("error" in member) return NextResponse.json({ error: member.error }, { status: member.status });
  if (!(await ownedAgent(member.accountId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabaseAdmin().from("ai_agent_secrets").delete().eq("agent_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: false, keyId: null });
}
