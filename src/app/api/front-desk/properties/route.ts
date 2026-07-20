// ============================================================
// /api/front-desk/properties
//
//   GET  — list properties visible to the caller. Any member;
//          RLS (`front_desk_properties_select`) naturally scopes
//          the result to "all" for admins or the caller's
//          `front_desk_access_properties` grant for everyone else.
//   POST — create a property.                        Admin+.
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

const MAX_NAME_LEN = 120;
const MAX_ADDRESS_LEN = 300;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("front_desk_properties")
      .select("id, account_id, name, address, is_active, created_at, updated_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/front-desk/properties] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load properties" },
        { status: 500 },
      );
    }

    return NextResponse.json({ properties: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskPropertyCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; address?: unknown }
      | null;

    const rawName = body?.name;
    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      return NextResponse.json(
        { error: "'name' is required" },
        { status: 400 },
      );
    }
    const name = rawName.trim();
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Property name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    let address: string | null = null;
    if (typeof body?.address === "string") {
      const trimmed = body.address.trim();
      if (trimmed.length > MAX_ADDRESS_LEN) {
        return NextResponse.json(
          { error: `Address must be ${MAX_ADDRESS_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      address = trimmed === "" ? null : trimmed;
    }

    const { data, error } = await ctx.supabase
      .from("front_desk_properties")
      .insert({ account_id: ctx.accountId, name, address })
      .select("id, account_id, name, address, is_active, created_at, updated_at")
      .single();

    if (error) {
      console.error("[POST /api/front-desk/properties] insert error:", error);
      return NextResponse.json(
        { error: "Failed to create property" },
        { status: 500 },
      );
    }

    return NextResponse.json({ property: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
