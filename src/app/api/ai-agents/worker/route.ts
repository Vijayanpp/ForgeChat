import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { drainAgentJobs } from "@/lib/agents";

export const maxDuration = 60;

function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Drain due AI agent reply jobs. Hit on a schedule (every minute) by
 * Vercel Cron or an external pinger with `x-cron-secret`. Required
 * when AI_AGENT_DISPATCH=cron; a safety net otherwise.
 */
export async function GET(request: Request) {
  const expected = process.env.AI_AGENT_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("x-cron-secret"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { processed } = await drainAgentJobs({ timeBudgetMs: 50_000 });
  return NextResponse.json({ processed });
}
