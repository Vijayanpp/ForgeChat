import { NextResponse } from "next/server";
import { resolveRuntimeFields } from "@/lib/agents/api";
import { createClient } from "@/lib/supabase/server";

/** Changes that alter agent behaviour bump config_version (traced per run). */
const BEHAVIOUR_FIELDS = ["system_prompt", "model", "temperature", "context_message_limit"] as const;

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await resolveAccountId(supabase);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { data, error } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ agent: data });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await resolveAccountId(supabase);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.description === "string") {
    update.description = body.description.trim() || null;
  }
  if (typeof body.system_prompt === "string" && body.system_prompt.trim()) {
    update.system_prompt = body.system_prompt.trim();
  }
  if (typeof body.model === "string" && body.model.trim()) {
    update.model = body.model.trim();
  }
  if (typeof body.temperature === "number" && Number.isFinite(body.temperature)) {
    update.temperature = Math.max(0, Math.min(2, body.temperature));
  }
  if (
    typeof body.context_message_limit === "number" &&
    Number.isFinite(body.context_message_limit)
  ) {
    update.context_message_limit = Math.max(
      1,
      Math.min(50, Math.round(body.context_message_limit)),
    );
  }
  if (body.status === "active" || body.status === "draft") {
    update.status = body.status;
  }

  const { data: existing, error: existingErr } = await supabase
    .from("ai_agents")
    .select("engine, agent_type, config, config_version")
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const runtime = resolveRuntimeFields(body as Record<string, unknown>, existing);
  if (!runtime.ok) {
    return NextResponse.json({ error: runtime.error }, { status: 400 });
  }
  if (runtime.changed) Object.assign(update, runtime.fields);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  if (runtime.changed || BEHAVIOUR_FIELDS.some((f) => f in update)) {
    update.config_version = ((existing.config_version as number | null) ?? 1) + 1;
  }

  const { data, error } = await supabase
    .from("ai_agents")
    .update(update)
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ agent: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await resolveAccountId(supabase);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { error } = await supabase
    .from("ai_agents")
    .delete()
    .eq("id", id)
    .eq("account_id", ctx.accountId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
