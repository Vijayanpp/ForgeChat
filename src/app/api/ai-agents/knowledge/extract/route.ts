import { NextResponse } from "next/server";

import { extractKnowledgeFile, KnowledgeFileError } from "@/lib/agents/knowledge/extract";
import { MAX_UPLOAD_BYTES } from "@/lib/agents/knowledge/limits";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Turns an uploaded document into knowledge-base text. Nothing is
 * stored: the text goes back to the agent form, where the admin
 * reviews it before saving the agent.
 */
export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 });
  }

  const { data: isAdmin } = await supabase.rpc("is_account_member", {
    target_account_id: accountId,
    min_role: "admin",
  });
  if (isAdmin !== true) {
    return NextResponse.json({ error: "Only admins can edit AI agents." }, { status: 403 });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "File is larger than 8 MB." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a file in the \"file\" field." }, { status: 400 });
  }

  try {
    const result = await extractKnowledgeFile(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({
      fileName: file.name,
      format: result.format,
      pages: result.pages ?? null,
      chars: result.text.length,
      text: result.text,
    });
  } catch (err) {
    if (err instanceof KnowledgeFileError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[ai-agents] knowledge extraction failed", err);
    return NextResponse.json({ error: "Could not read this file." }, { status: 500 });
  }
}
