// ============================================================
// /api/front-desk/guest-entries
//
//   GET  — scope-aware read. Applies the caller's Front Desk
//          permission context (see src/lib/front-desk/permissions.ts)
//          on top of RLS: history_scope forces "today only" when
//          set, property scope filters to the caller's grant, and
//          the response shape itself omits `entries` / `summary`
//          for flags the caller lacks (defense in depth — even if
//          a client bug tried to render them, there's no data to
//          leak).
//   POST — create a check-in. Requires can_manage_entries.
//
// Every member can call GET (RLS + the app-level context below
// naturally scope it to "nothing" for someone with no grant);
// `hasNoFrontDeskAccess` short-circuits that case to a clean 403
// instead of a confusing empty-everything 200.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import {
  getFrontDeskContext,
  hasNoFrontDeskAccess,
  todayBoundaryIso,
} from "@/lib/front-desk/permissions";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer", "other"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === "string" && (PAYMENT_MODES as readonly string[]).includes(value);
}

// Rows returned by the shared query below — a superset of what
// either the itemized list or the aggregate-only summary needs.
interface EntryRow {
  id: string;
  property_id: string;
  contact_id: string | null;
  entered_by: string | null;
  guest_name: string;
  phone: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  number_of_guests: number;
  room_number: string | null;
  amount_paid: number;
  currency: string;
  payment_mode: PaymentMode;
  check_in_at: string;
  expected_check_out_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_ROWS = 1000;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const isAdmin = hasMinRole(ctx.role, "admin");
    const fd = await getFrontDeskContext(ctx.supabase, ctx.accountId, ctx.userId, isAdmin);

    if (hasNoFrontDeskAccess(fd)) {
      return NextResponse.json({ error: "No Front Desk access" }, { status: 403 });
    }

    // Zero-property scope means "granted, but scoped to nothing" —
    // short-circuit rather than let `.in('property_id', [])` reach
    // Postgres (an empty IN-list is valid but a wasted round trip).
    if (fd.propertyIds !== null && fd.propertyIds.length === 0) {
      return NextResponse.json({
        entries: fd.canViewGuestDetails ? [] : undefined,
        summary: fd.canViewCashTotal
          ? { guestCount: 0, bookingCount: 0, totalAmount: 0, byPaymentMode: {} }
          : undefined,
        historyScope: fd.historyScope,
        canViewGuestDetails: fd.canViewGuestDetails,
        canViewCashTotal: fd.canViewCashTotal,
        canManageEntries: fd.canManageEntries,
        canExport: fd.canExport,
      });
    }

    const url = new URL(request.url);
    const propertyIdParam = url.searchParams.get("propertyId");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    let query = ctx.supabase
      .from("front_desk_guest_entries")
      .select(
        "id, property_id, contact_id, entered_by, guest_name, phone, id_proof_type, id_proof_number, number_of_guests, room_number, amount_paid, currency, payment_mode, check_in_at, expected_check_out_at, notes, created_at, updated_at",
      )
      .eq("account_id", ctx.accountId)
      .order("check_in_at", { ascending: false })
      .limit(MAX_ROWS);

    if (propertyIdParam) {
      if (fd.propertyIds !== null && !fd.propertyIds.includes(propertyIdParam)) {
        return NextResponse.json(
          { error: "You don't have access to this property" },
          { status: 403 },
        );
      }
      query = query.eq("property_id", propertyIdParam);
    } else if (fd.propertyIds !== null) {
      query = query.in("property_id", fd.propertyIds);
    }

    // Receptionists on 'today_only' can never widen the window —
    // any `from`/`to` they pass is ignored server-side. RLS enforces
    // the same cutoff independently, so this is belt-and-braces.
    if (fd.historyScope === "today_only") {
      query = query.gte("check_in_at", todayBoundaryIso());
    } else {
      if (fromParam) query = query.gte("check_in_at", fromParam);
      if (toParam) query = query.lte("check_in_at", toParam);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[GET /api/front-desk/guest-entries] fetch error:", error);
      return NextResponse.json({ error: "Failed to load guest entries" }, { status: 500 });
    }

    const rows = (data ?? []) as EntryRow[];

    const summary = fd.canViewCashTotal
      ? rows.reduce(
          (acc, row) => {
            acc.guestCount += row.number_of_guests;
            acc.bookingCount += 1;
            acc.totalAmount += Number(row.amount_paid);
            acc.byPaymentMode[row.payment_mode] =
              (acc.byPaymentMode[row.payment_mode] ?? 0) + Number(row.amount_paid);
            return acc;
          },
          {
            guestCount: 0,
            bookingCount: 0,
            totalAmount: 0,
            byPaymentMode: {} as Record<string, number>,
          },
        )
      : undefined;

    return NextResponse.json({
      entries: fd.canViewGuestDetails ? rows : undefined,
      summary,
      historyScope: fd.historyScope,
      canViewGuestDetails: fd.canViewGuestDetails,
      canViewCashTotal: fd.canViewCashTotal,
      canManageEntries: fd.canManageEntries,
      canExport: fd.canExport,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const isAdmin = hasMinRole(ctx.role, "admin");
    const fd = await getFrontDeskContext(ctx.supabase, ctx.accountId, ctx.userId, isAdmin);

    if (!fd.canManageEntries) {
      return NextResponse.json(
        { error: "You don't have permission to log guests" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(`frontDesk:guestCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          propertyId?: unknown;
          guestName?: unknown;
          phone?: unknown;
          idProofType?: unknown;
          idProofNumber?: unknown;
          numberOfGuests?: unknown;
          roomNumber?: unknown;
          amountPaid?: unknown;
          currency?: unknown;
          paymentMode?: unknown;
          expectedCheckOutAt?: unknown;
          notes?: unknown;
        }
      | null;

    const propertyId = body?.propertyId;
    if (typeof propertyId !== "string" || propertyId.trim().length === 0) {
      return NextResponse.json({ error: "'propertyId' is required" }, { status: 400 });
    }
    if (fd.propertyIds !== null && !fd.propertyIds.includes(propertyId)) {
      return NextResponse.json(
        { error: "You don't have access to this property" },
        { status: 403 },
      );
    }

    const guestName = body?.guestName;
    if (typeof guestName !== "string" || guestName.trim().length === 0) {
      return NextResponse.json({ error: "'guestName' is required" }, { status: 400 });
    }

    const paymentMode = isPaymentMode(body?.paymentMode) ? body.paymentMode : "cash";

    const amountPaidRaw = body?.amountPaid;
    const amountPaid =
      typeof amountPaidRaw === "number" && Number.isFinite(amountPaidRaw) && amountPaidRaw >= 0
        ? amountPaidRaw
        : 0;

    const numberOfGuestsRaw = body?.numberOfGuests;
    const numberOfGuests =
      typeof numberOfGuestsRaw === "number" && Number.isInteger(numberOfGuestsRaw) && numberOfGuestsRaw > 0
        ? numberOfGuestsRaw
        : 1;

    const phone = typeof body?.phone === "string" && body.phone.trim() ? body.phone.trim() : null;

    // Link (or create) the WhatsApp contact for this guest so the
    // booking becomes part of their CRM timeline — see
    // front_desk_link_contact() in migration 030. Best-effort: a
    // bad/missing phone just means no link, never blocks the
    // check-in itself (the front desk still needs to work if a
    // guest has no phone or gives a garbled one).
    let contactId: string | null = null;
    if (phone) {
      const { data: linkedId, error: linkError } = await ctx.supabase.rpc("front_desk_link_contact", {
        p_account_id: ctx.accountId,
        p_phone: phone,
        p_name: guestName.trim(),
      });
      if (linkError) {
        console.error("[POST /api/front-desk/guest-entries] contact link error:", linkError);
      } else {
        contactId = linkedId;
      }
    }

    const insertPayload = {
      account_id: ctx.accountId,
      property_id: propertyId,
      contact_id: contactId,
      entered_by: ctx.userId,
      guest_name: guestName.trim(),
      phone,
      id_proof_type:
        typeof body?.idProofType === "string" && body.idProofType.trim() ? body.idProofType.trim() : null,
      id_proof_number:
        typeof body?.idProofNumber === "string" && body.idProofNumber.trim()
          ? body.idProofNumber.trim()
          : null,
      number_of_guests: numberOfGuests,
      room_number:
        typeof body?.roomNumber === "string" && body.roomNumber.trim() ? body.roomNumber.trim() : null,
      amount_paid: amountPaid,
      currency: typeof body?.currency === "string" && body.currency.trim() ? body.currency.trim() : "INR",
      payment_mode: paymentMode,
      expected_check_out_at:
        typeof body?.expectedCheckOutAt === "string" && body.expectedCheckOutAt.trim()
          ? body.expectedCheckOutAt.trim()
          : null,
      notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    };

    const { data, error } = await ctx.supabase
      .from("front_desk_guest_entries")
      .insert(insertPayload)
      .select(
        "id, property_id, contact_id, entered_by, guest_name, phone, id_proof_type, id_proof_number, number_of_guests, room_number, amount_paid, currency, payment_mode, check_in_at, expected_check_out_at, notes, created_at, updated_at",
      )
      .single();

    if (error) {
      console.error("[POST /api/front-desk/guest-entries] insert error:", error);
      return NextResponse.json({ error: "Failed to log guest" }, { status: 500 });
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
