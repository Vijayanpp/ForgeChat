// ============================================================
// /api/front-desk
//
//   GET   — current caller's Front Desk module status. Any member
//           (the settings tab and sidebar both need to know
//           whether the module is on, even for non-admins so a
//           granted receptionist's nav item renders).
//   PATCH — turn the module on/off for the account.       Admin+.
//
// Toggling off does NOT delete any data (properties, guest
// entries, and access grants all survive) — it only hides the nav
// item / settings tab and blocks new access grants, so re-enabling
// later picks up exactly where the account left off.
// ============================================================

import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("accounts")
      .select("front_desk_enabled")
      .eq("id", ctx.accountId)
      .single();

    if (error) {
      console.error("[GET /api/front-desk] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load Front Desk status" },
        { status: 500 },
      );
    }

    return NextResponse.json({ enabled: !!data.front_desk_enabled });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskToggle:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { enabled?: unknown }
      | null;

    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json(
        { error: "'enabled' must be a boolean" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ front_desk_enabled: body.enabled })
      .eq("id", ctx.accountId)
      .select("front_desk_enabled")
      .single();

    if (error) {
      console.error("[PATCH /api/front-desk] update error:", error);
      return NextResponse.json(
        { error: "Failed to update Front Desk status" },
        { status: 500 },
      );
    }

    return NextResponse.json({ enabled: !!data.front_desk_enabled });
  } catch (err) {
    return toErrorResponse(err);
  }
}
