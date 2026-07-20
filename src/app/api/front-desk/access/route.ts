// ============================================================
// /api/front-desk/access
//
//   GET  — list every Front Desk access grant for the account,
//          joined with the grantee's name/email.        Admin+.
//   POST — grant a NEW user access.                     Admin+.
//
// Granting access is independent of `profiles.account_role` — the
// target can be an existing agent/viewer teammate (pick them from
// /api/account/members) or a dedicated `front_desk`-role login
// invited separately via POST /api/account/invitations with
// `role: 'front_desk'` (that endpoint is role-agnostic already,
// see migration 017-019 — no changes needed there). Either way,
// once the user is a member of the account, this endpoint is what
// actually turns on their Front Desk visibility.
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

interface AccessRow {
  id: string;
  account_id: string;
  user_id: string;
  history_scope: HistoryScope;
  can_view_guest_details: boolean;
  can_view_cash_total: boolean;
  can_export: boolean;
  can_manage_entries: boolean;
  created_at: string;
  updated_at: string;
  front_desk_access_properties: { property_id: string }[] | null;
}

interface ProfileLookup {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await ctx.supabase
      .from("front_desk_access")
      .select(
        "id, account_id, user_id, history_scope, can_view_guest_details, can_view_cash_total, can_export, can_manage_entries, created_at, updated_at, front_desk_access_properties(property_id)",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/front-desk/access] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load access grants" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as AccessRow[];
    const userIds = rows.map((r) => r.user_id);

    let profilesById = new Map<string, ProfileLookup>();
    if (userIds.length > 0) {
      const { data: profiles } = await ctx.supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      profilesById = new Map((profiles ?? []).map((p: ProfileLookup) => [p.user_id, p]));
    }

    const access = rows.map((row) => {
      const profile = profilesById.get(row.user_id);
      return {
        id: row.id,
        account_id: row.account_id,
        user_id: row.user_id,
        history_scope: row.history_scope,
        can_view_guest_details: row.can_view_guest_details,
        can_view_cash_total: row.can_view_cash_total,
        can_export: row.can_export,
        can_manage_entries: row.can_manage_entries,
        created_at: row.created_at,
        updated_at: row.updated_at,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        property_ids: (row.front_desk_access_properties ?? []).map((p) => p.property_id),
      };
    });

    return NextResponse.json({ access });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:frontDeskAccessCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          userId?: unknown;
          historyScope?: unknown;
          canViewGuestDetails?: unknown;
          canViewCashTotal?: unknown;
          canExport?: unknown;
          canManageEntries?: unknown;
          propertyIds?: unknown;
        }
      | null;

    const userId = body?.userId;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return NextResponse.json({ error: "'userId' is required" }, { status: 400 });
    }

    // Target must already be a member of the caller's account —
    // RLS on `profiles` scopes this read to the caller's account,
    // so a non-member id simply won't be found.
    const { data: targetProfile, error: profileError } = await ctx.supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (profileError) {
      console.error("[POST /api/front-desk/access] profile lookup error:", profileError);
      return NextResponse.json({ error: "Failed to verify member" }, { status: 500 });
    }
    if (!targetProfile) {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 400 },
      );
    }

    const historyScope = isHistoryScope(body?.historyScope) ? body.historyScope : "today_only";

    const propertyIdsRaw = body?.propertyIds;
    const propertyIds =
      Array.isArray(propertyIdsRaw) && propertyIdsRaw.every((v) => typeof v === "string")
        ? (propertyIdsRaw as string[])
        : [];

    const { data: access, error: insertError } = await ctx.supabase
      .from("front_desk_access")
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        history_scope: historyScope,
        can_view_guest_details: body?.canViewGuestDetails !== false,
        can_view_cash_total: body?.canViewCashTotal !== false,
        can_export: body?.canExport === true,
        can_manage_entries: body?.canManageEntries !== false,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[POST /api/front-desk/access] insert error:", insertError);
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "This user already has Front Desk access — edit their existing grant instead" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Failed to grant access" }, { status: 500 });
    }

    if (propertyIds.length > 0) {
      const { error: joinError } = await ctx.supabase
        .from("front_desk_access_properties")
        .insert(propertyIds.map((propertyId) => ({ access_id: access.id, property_id: propertyId })));
      if (joinError) {
        console.error("[POST /api/front-desk/access] property scoping error:", joinError);
        // Non-fatal — the grant exists with "all properties" scope;
        // an admin can fix the scoping via PATCH.
      }
    }

    return NextResponse.json({ ok: true, id: access.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
