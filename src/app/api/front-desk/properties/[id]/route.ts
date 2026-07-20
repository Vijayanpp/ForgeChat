// ============================================================
// /api/front-desk/properties/[id]
//
//   PATCH  — rename / re-address / activate-deactivate.  Admin+.
//   DELETE — remove a property.                          Admin+.
//
// DELETE is blocked (409) when the property has any guest
// entries — `front_desk_guest_entries.property_id` cascades on
// delete, so a hard delete would silently wipe check-in history.
// Deactivating (PATCH is_active=false) is the safe alternative:
// it drops the property out of the "add new guest" pickers while
// keeping every past entry intact.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_NAME_LEN = 120;
const MAX_ADDRESS_LEN = 300;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskPropertyUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; address?: unknown; is_active?: unknown }
      | null;

    const patch: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: "'name' cannot be empty" },
          { status: 400 },
        );
      }
      if (body.name.trim().length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Property name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      patch.name = body.name.trim();
    }

    if (body?.address !== undefined) {
      if (body.address !== null && typeof body.address !== "string") {
        return NextResponse.json(
          { error: "'address' must be a string or null" },
          { status: 400 },
        );
      }
      const trimmed = typeof body.address === "string" ? body.address.trim() : null;
      if (trimmed && trimmed.length > MAX_ADDRESS_LEN) {
        return NextResponse.json(
          { error: `Address must be ${MAX_ADDRESS_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      patch.address = trimmed || null;
    }

    if (body?.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json(
          { error: "'is_active' must be a boolean" },
          { status: 400 },
        );
      }
      patch.is_active = body.is_active;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("front_desk_properties")
      .update(patch)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id, account_id, name, address, is_active, created_at, updated_at")
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/front-desk/properties/[id]] update error:", error);
      return NextResponse.json(
        { error: "Failed to update property" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    return NextResponse.json({ property: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskPropertyDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { count, error: countError } = await ctx.supabase
      .from("front_desk_guest_entries")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id);

    if (countError) {
      console.error("[DELETE /api/front-desk/properties/[id]] count error:", countError);
      return NextResponse.json(
        { error: "Failed to check property history" },
        { status: 500 },
      );
    }
    if (count && count > 0) {
      return NextResponse.json(
        {
          error:
            "This property has guest history and can't be deleted — deactivate it instead to preserve records.",
        },
        { status: 409 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("front_desk_properties")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/front-desk/properties/[id]] delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete property" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
