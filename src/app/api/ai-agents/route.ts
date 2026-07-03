import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  assertAccountWritable,
  assertWithinLimit,
  getAccountBilling,
  toBillingErrorResponse,
} from "@/lib/billing/limits";

async function resolveAccountId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Unauthorized" as const, status: 401 as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return { error: "Your profile is not linked to an account." as const, status: 403 as const };
  }

  return { user, accountId };
}

export async function GET() {
  const supabase = await createClient();
  const ctx = await resolveAccountId(supabase);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { data, error } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("account_id", ctx.accountId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agents: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const ctx = await resolveAccountId(supabase);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  try {
    const billing = await getAccountBilling(supabase, ctx.accountId);
    assertAccountWritable(billing.subscriptionStatus);
    await assertWithinLimit(supabase, ctx.accountId, billing.planId, "aiAgents");
  } catch (err) {
    const billingResponse = toBillingErrorResponse(err);
    if (billingResponse) return billingResponse;
    throw err;
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    name,
    description,
    system_prompt,
    model,
    temperature,
    context_message_limit,
    status,
  } = body as Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!system_prompt || typeof system_prompt !== "string" || !system_prompt.trim()) {
    return NextResponse.json({ error: "system_prompt is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ai_agents")
    .insert({
      account_id: ctx.accountId,
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      system_prompt: system_prompt.trim(),
      model: typeof model === "string" && model.trim() ? model.trim() : "gpt-4o",
      temperature:
        typeof temperature === "number" && Number.isFinite(temperature)
          ? Math.max(0, Math.min(2, temperature))
          : 0.8,
      context_message_limit:
        typeof context_message_limit === "number" &&
        Number.isFinite(context_message_limit)
          ? Math.max(1, Math.min(50, Math.round(context_message_limit)))
          : 15,
      status: status === "active" ? "active" : "draft",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agent: data }, { status: 201 });
}
