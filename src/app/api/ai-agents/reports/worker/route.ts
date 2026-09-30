import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportWorkerDeps } from "@/lib/agents/reports/runtime";
import { drainReports } from "@/lib/agents/reports/worker";

export const maxDuration = 300;

function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Generate, email and deliver queued paid reports. Hit every minute
 * with `x-cron-secret` (same secret as the agent worker). A report
 * takes 1-2 minutes, hence the longer duration than the reply worker.
 */
export async function GET(request: Request) {
  const expected = process.env.AI_AGENT_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-cron-secret"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { processed } = await drainReports(reportWorkerDeps(), { timeBudgetMs: 240_000 });
  return NextResponse.json({ processed });
}
