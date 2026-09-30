import { supabaseAdmin } from "@/lib/automations/admin-client";
import { hashReportToken } from "@/lib/agents/reports/token";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function notFound() {
  return new Response("<!DOCTYPE html><title>Report not found</title><p>This report link is invalid or has expired.</p>", {
    status: 404,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Private report link sent to the customer (the token is the only credential). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return notFound();

  const { data } = await supabaseAdmin()
    .from("ai_agent_reports")
    .select("html")
    .eq("access_token_hash", hashReportToken(token))
    .not("html", "is", null)
    .maybeSingle();
  if (!data?.html) return notFound();

  return new Response(data.html as string, {
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
