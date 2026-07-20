// ============================================================
// Front Desk permissions — server-side context helper.
//
// Mirrors the RLS helpers from migration 029
// (front_desk_can_access_property / _can_view_entry / _can_manage_entry)
// in TypeScript so API routes and the dashboard page can decide
// *what to render* without re-deriving the rules by hand. RLS is
// still the enforcement layer — this helper is for shaping
// queries and responses, not a substitute for it.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FrontDeskContext } from "@/types";

interface AccessRow {
  history_scope: "today_only" | "full_history";
  can_view_guest_details: boolean;
  can_view_cash_total: boolean;
  can_export: boolean;
  can_manage_entries: boolean;
  front_desk_access_properties: { property_id: string }[] | null;
}

/**
 * Resolve the caller's Front Desk permission context.
 *
 * Owner/admin short-circuit to unrestricted access (matches the
 * `is_account_member(account_id, 'admin')` bypass baked into
 * every RLS policy on the front_desk_* tables). Everyone else
 * needs a `front_desk_access` row — its absence collapses to the
 * all-false/no-property context, which every call site should
 * treat as "no access to this module".
 *
 * `supabase` must be the caller's RLS-scoped SSR client — this
 * function relies on the `front_desk_access_select` policy (self
 * row readable) rather than the service role, so it never leaks
 * another user's grant.
 */
export async function getFrontDeskContext(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  isAccountAdmin: boolean,
): Promise<FrontDeskContext> {
  if (isAccountAdmin) {
    return {
      isAdmin: true,
      historyScope: "full_history",
      canViewGuestDetails: true,
      canViewCashTotal: true,
      canExport: true,
      canManageEntries: true,
      propertyIds: null,
    };
  }

  const { data, error } = await supabase
    .from("front_desk_access")
    .select(
      "history_scope, can_view_guest_details, can_view_cash_total, can_export, can_manage_entries, front_desk_access_properties(property_id)",
    )
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[getFrontDeskContext] fetch error:", error);
  }

  const row = data as AccessRow | null;
  if (!row) {
    // No grant — every capability is false and propertyIds is an
    // (empty, non-null) array so a naive `.in('property_id', ids)`
    // filter yields zero rows rather than accidentally matching
    // "all properties" (which is what `null` means everywhere else
    // in this module).
    return {
      isAdmin: false,
      historyScope: "today_only",
      canViewGuestDetails: false,
      canViewCashTotal: false,
      canExport: false,
      canManageEntries: false,
      propertyIds: [],
    };
  }

  const scopedProperties = row.front_desk_access_properties ?? [];

  return {
    isAdmin: false,
    historyScope: row.history_scope,
    canViewGuestDetails: row.can_view_guest_details,
    canViewCashTotal: row.can_view_cash_total,
    canExport: row.can_export,
    canManageEntries: row.can_manage_entries,
    // No scoping rows = every property (mirrors the RLS helpers'
    // "NOT EXISTS(...) OR EXISTS(matching row)" logic).
    propertyIds: scopedProperties.length === 0 ? null : scopedProperties.map((p) => p.property_id),
  };
}

/** True if the resolved context grants no access at all — the
 *  caller should treat this as a 403 / "module not available". */
export function hasNoFrontDeskAccess(ctx: FrontDeskContext): boolean {
  return (
    !ctx.isAdmin &&
    !ctx.canViewGuestDetails &&
    !ctx.canViewCashTotal &&
    !ctx.canManageEntries &&
    !ctx.canExport
  );
}

/** Start-of-day (UTC) ISO boundary for "today" — matches the SQL
 *  `date_trunc('day', NOW())` used by the RLS helpers, so the API
 *  layer's own filtering (defense in depth on top of RLS) applies
 *  the exact same cutoff. */
export function todayBoundaryIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
