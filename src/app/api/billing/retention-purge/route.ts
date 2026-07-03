import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/billing/admin-client";
import { findAccountsPendingPurge, purgeAccount } from "@/lib/billing/retention";

/**
 * Permanently deletes accounts that have been `canceled` for more than
 * `RETENTION_GRACE_DAYS` (30), per the Privacy Policy's data retention
 * promise. Meant to be hit on a daily schedule (Vercel Cron / external
 * pinger) — requires a shared secret via the `x-cron-secret` header to
 * match `DATA_RETENTION_CRON_SECRET`. Mirrors the pattern used by
 * GET /api/automations/cron.
 *
 * This is a destructive, irreversible action. Pass `?dryRun=true` to
 * see which accounts *would* be purged without deleting anything —
 * use this to sanity-check before wiring up a real schedule.
 */
export async function GET(request: Request) {
  const expected = process.env.DATA_RETENTION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "retention purge not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const admin = supabaseAdmin();

  let candidates;
  try {
    candidates = await findAccountsPendingPurge(admin);
  } catch (err) {
    console.error("[GET /api/billing/retention-purge] query failed:", err);
    return NextResponse.json({ error: "Failed to query candidate accounts" }, { status: 500 });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ dryRun, candidates: 0, purged: 0, results: [] });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      candidates: candidates.length,
      purged: 0,
      results: candidates.map((a) => ({
        accountId: a.id,
        accountName: a.name,
        subscription_status: a.subscription_status,
        current_period_end: a.current_period_end,
      })),
    });
  }

  const results = [];
  for (const account of candidates) {
    const result = await purgeAccount(admin, account);
    if (result.error) {
      console.error(
        `[GET /api/billing/retention-purge] failed to purge account ${account.id}:`,
        result.error,
      );
    }
    results.push(result);
  }

  const purged = results.filter((r) => r.purged).length;
  return NextResponse.json({ dryRun: false, candidates: candidates.length, purged, results });
}
