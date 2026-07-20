// ============================================================
// /api/front-desk/guest-entries/[id]
//
//   PATCH  — edit a guest entry.   Requires can_manage_entries.
//   DELETE — remove a guest entry. Requires can_manage_entries.
//
// Both re-check the row's OWN property/date scope after loading it
// (not just "does this user have can_manage_entries at all") so a
// property-scoped or today_only-scoped receptionist can't edit/
// delete rows outside their grant — RLS enforces the same rule
// independently (front_desk_can_manage_entry), this is defense in
// depth for a clearer 403 instead of an opaque RLS-silenced 404.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { getFrontDeskContext } from "@/lib/front-desk/permissions";
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

function canTouchEntry(
  fd: { canManageEntries: boolean; historyScope: "today_only" | "full_history"; propertyIds: string[] | null; isAdmin: boolean },
  entry: { property_id: string; check_in_at: string },
): boolean {
  if (fd.isAdmin) return true;
  if (!fd.canManageEntries) return false;
  if (fd.propertyIds !== null && !fd.propertyIds.includes(entry.property_id)) return false;
  if (fd.historyScope === "today_only") {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (new Date(entry.check_in_at).getTime() < todayStart.getTime()) return false;
  }
  return true;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const isAdmin = hasMinRole(ctx.role, "admin");
    const fd = await getFrontDeskContext(ctx.supabase, ctx.accountId, ctx.userId, isAdmin);

    const limit = checkRateLimit(`frontDesk:guestUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data: existing, error: fetchError } = await ctx.supabase
      .from("front_desk_guest_entries")
      .select("id, property_id, check_in_at, phone, guest_name")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (fetchError) {
      console.error("[PATCH /api/front-desk/guest-entries/[id]] fetch error:", fetchError);
      return NextResponse.json({ error: "Failed to load guest entry" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Guest entry not found" }, { status: 404 });
    }
    if (!canTouchEntry(fd, existing)) {
      return NextResponse.json(
        { error: "You don't have permission to edit this entry" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | {
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

    const patch: Record<string, unknown> = {};

    if (body?.guestName !== undefined) {
      if (typeof body.guestName !== "string" || body.guestName.trim().length === 0) {
        return NextResponse.json({ error: "'guestName' cannot be empty" }, { status: 400 });
      }
      patch.guest_name = body.guestName.trim();
    }
    if (body?.phone !== undefined) {
      patch.phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    }

    // Re-resolve the linked WhatsApp contact whenever the phone or
    // name changed, so editing a booking keeps it pointed at the
    // right contact instead of silently drifting out of sync.
    if (patch.phone !== undefined || patch.guest_name !== undefined) {
      const nextPhone = (patch.phone !== undefined ? patch.phone : existing.phone) as string | null;
      const nextName = (patch.guest_name !== undefined ? patch.guest_name : existing.guest_name) as string;
      if (nextPhone) {
        const { data: linkedId, error: linkError } = await ctx.supabase.rpc("front_desk_link_contact", {
          p_account_id: ctx.accountId,
          p_phone: nextPhone,
          p_name: nextName,
        });
        if (linkError) {
          console.error("[PATCH /api/front-desk/guest-entries/[id]] contact link error:", linkError);
        } else {
          patch.contact_id = linkedId;
        }
      } else {
        patch.contact_id = null;
      }
    }
    if (body?.idProofType !== undefined) {
      patch.id_proof_type =
        typeof body.idProofType === "string" && body.idProofType.trim() ? body.idProofType.trim() : null;
    }
    if (body?.idProofNumber !== undefined) {
      patch.id_proof_number =
        typeof body.idProofNumber === "string" && body.idProofNumber.trim()
          ? body.idProofNumber.trim()
          : null;
    }
    if (body?.numberOfGuests !== undefined) {
      if (
        typeof body.numberOfGuests !== "number" ||
        !Number.isInteger(body.numberOfGuests) ||
        body.numberOfGuests <= 0
      ) {
        return NextResponse.json(
          { error: "'numberOfGuests' must be a positive integer" },
          { status: 400 },
        );
      }
      patch.number_of_guests = body.numberOfGuests;
    }
    if (body?.roomNumber !== undefined) {
      patch.room_number =
        typeof body.roomNumber === "string" && body.roomNumber.trim() ? body.roomNumber.trim() : null;
    }
    if (body?.amountPaid !== undefined) {
      if (typeof body.amountPaid !== "number" || !Number.isFinite(body.amountPaid) || body.amountPaid < 0) {
        return NextResponse.json(
          { error: "'amountPaid' must be a non-negative number" },
          { status: 400 },
        );
      }
      patch.amount_paid = body.amountPaid;
    }
    if (body?.currency !== undefined) {
      if (typeof body.currency !== "string" || body.currency.trim().length === 0) {
        return NextResponse.json({ error: "'currency' cannot be empty" }, { status: 400 });
      }
      patch.currency = body.currency.trim();
    }
    if (body?.paymentMode !== undefined) {
      if (!isPaymentMode(body.paymentMode)) {
        return NextResponse.json(
          { error: `'paymentMode' must be one of ${PAYMENT_MODES.join(", ")}` },
          { status: 400 },
        );
      }
      patch.payment_mode = body.paymentMode;
    }
    if (body?.expectedCheckOutAt !== undefined) {
      patch.expected_check_out_at =
        typeof body.expectedCheckOutAt === "string" && body.expectedCheckOutAt.trim()
          ? body.expectedCheckOutAt.trim()
          : null;
    }
    if (body?.notes !== undefined) {
      patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("front_desk_guest_entries")
      .update(patch)
      .eq("id", id)
      .select(
        "id, property_id, contact_id, entered_by, guest_name, phone, id_proof_type, id_proof_number, number_of_guests, room_number, amount_paid, currency, payment_mode, check_in_at, expected_check_out_at, notes, created_at, updated_at",
      )
      .single();

    if (error) {
      console.error("[PATCH /api/front-desk/guest-entries/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update guest entry" }, { status: 500 });
    }

    return NextResponse.json({ entry: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const isAdmin = hasMinRole(ctx.role, "admin");
    const fd = await getFrontDeskContext(ctx.supabase, ctx.accountId, ctx.userId, isAdmin);

    const limit = checkRateLimit(`frontDesk:guestDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data: existing, error: fetchError } = await ctx.supabase
      .from("front_desk_guest_entries")
      .select("id, property_id, check_in_at")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (fetchError) {
      console.error("[DELETE /api/front-desk/guest-entries/[id]] fetch error:", fetchError);
      return NextResponse.json({ error: "Failed to load guest entry" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Guest entry not found" }, { status: 404 });
    }
    if (!canTouchEntry(fd, existing)) {
      return NextResponse.json(
        { error: "You don't have permission to delete this entry" },
        { status: 403 },
      );
    }

    const { error } = await ctx.supabase.from("front_desk_guest_entries").delete().eq("id", id);

    if (error) {
      console.error("[DELETE /api/front-desk/guest-entries/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete guest entry" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
