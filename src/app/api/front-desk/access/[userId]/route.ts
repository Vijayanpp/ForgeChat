// ============================================================
// /api/front-desk/access/[userId]
//
//   PATCH  — update an existing grant's flags/scope/properties.
//   DELETE — revoke access entirely.
//
// Both admin+. [userId] identifies the access row's user_id
// (unique per account_id + user_id — see migration 029), not the
// access row's own id, so the Settings UI doesn't need a second
// round trip just to look up the row id after listing members.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const HISTORY_SCOPES = ["today_only", "full_history"] as const;
type HistoryScope = (typeof HISTORY_SCOPES)[number];

function isHistoryScope(value: unknown): value is HistoryScope {
  return typeof value === "string" && (HISTORY_SCOPES as readonly string[]).includes(value);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskAccessUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | {
          historyScope?: unknown;
          canViewGuestDetails?: unknown;
          canViewCashTotal?: unknown;
          canExport?: unknown;
          canManageEntries?: unknown;
          propertyIds?: unknown;
        }
      | null;

    const patch: Record<string, unknown> = {};
    if (body?.historyScope !== undefined) {
      if (!isHistoryScope(body.historyScope)) {
        return NextResponse.json(
          { error: "'historyScope' must be 'today_only' or 'full_history'" },
          { status: 400 },
        );
      }
      patch.history_scope = body.historyScope;
    }
    if (body?.canViewGuestDetails !== undefined) {
      patch.can_view_guest_details = !!body.canViewGuestDetails;
    }
    if (body?.canViewCashTotal !== undefined) {
      patch.can_view_cash_total = !!body.canViewCashTotal;
    }
    if (body?.canExport !== undefined) {
      patch.can_export = !!body.canExport;
    }
    if (body?.canManageEntries !== undefined) {
      patch.can_manage_entries = !!body.canManageEntries;
    }

    let access: { id: string } | null = null;

    if (Object.keys(patch).length > 0) {
      const { data, error } = await ctx.supabase
        .from("front_desk_access")
        .update(patch)
        .eq("account_id", ctx.accountId)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("[PATCH /api/front-desk/access/[userId]] update error:", error);
        return NextResponse.json({ error: "Failed to update access" }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Access grant not found" }, { status: 404 });
      }
      access = data;
    } else {
      const { data, error } = await ctx.supabase
        .from("front_desk_access")
        .select("id")
        .eq("account_id", ctx.accountId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) {
        return NextResponse.json({ error: "Access grant not found" }, { status: 404 });
      }
      access = data;
    }

    // Property scoping: replace-all when the key is present at all
    // (including an explicit empty array, which means "all
    // properties" — see the front_desk_access_properties comment
    // in migration 029).
    if (body?.propertyIds !== undefined) {
      const propertyIds =
        Array.isArray(body.propertyIds) && body.propertyIds.every((v) => typeof v === "string")
          ? (body.propertyIds as string[])
          : null;
      if (propertyIds === null) {
        return NextResponse.json(
          { error: "'propertyIds' must be an array of strings" },
          { status: 400 },
        );
      }

      const { error: deleteError } = await ctx.supabase
        .from("front_desk_access_properties")
        .delete()
        .eq("access_id", access.id);
      if (deleteError) {
        console.error("[PATCH /api/front-desk/access/[userId]] scoping delete error:", deleteError);
        return NextResponse.json({ error: "Failed to update property scope" }, { status: 500 });
      }

      if (propertyIds.length > 0) {
        const { error: insertError } = await ctx.supabase
          .from("front_desk_access_properties")
          .insert(propertyIds.map((propertyId) => ({ access_id: access!.id, property_id: propertyId })));
        if (insertError) {
          console.error("[PATCH /api/front-desk/access/[userId]] scoping insert error:", insertError);
          return NextResponse.json({ error: "Failed to update property scope" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskAccessRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase
      .from("front_desk_access")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/front-desk/access/[userId]] delete error:", error);
      return NextResponse.json({ error: "Failed to revoke access" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Access grant not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
