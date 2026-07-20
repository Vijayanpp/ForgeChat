"use client";

// ============================================================
// GuestEntryForm — sheet form for logging / editing a Front Desk
// check-in. Styled after src/components/pipelines/deal-form.tsx.
// A walk-in log, not a reservation — there's no "book for later"
// concept, only "log what just happened at the desk".
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FrontDeskGuestEntry, FrontDeskPaymentMode, FrontDeskProperty } from "@/types";

const PAYMENT_MODES: { value: FrontDeskPaymentMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

interface GuestEntryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: FrontDeskGuestEntry | null;
  properties: FrontDeskProperty[];
  defaultPropertyId?: string;
  canDelete?: boolean;
  onSaved: () => void;
}

export function GuestEntryForm({
  open,
  onOpenChange,
  entry,
  properties,
  defaultPropertyId,
  canDelete = false,
  onSaved,
}: GuestEntryFormProps) {
  const [propertyId, setPropertyId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [idProofType, setIdProofType] = useState("");
  const [idProofNumber, setIdProofNumber] = useState("");
  const [numberOfGuests, setNumberOfGuests] = useState("1");
  const [roomNumber, setRoomNumber] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMode, setPaymentMode] = useState<FrontDeskPaymentMode>("cash");
  const [expectedCheckOutAt, setExpectedCheckOutAt] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Prop-driven reset every time the sheet opens — same rationale
  // as deal-form.tsx's identical effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (entry) {
      setPropertyId(entry.property_id);
      setGuestName(entry.guest_name);
      setPhone(entry.phone ?? "");
      setIdProofType(entry.id_proof_type ?? "");
      setIdProofNumber(entry.id_proof_number ?? "");
      setNumberOfGuests(String(entry.number_of_guests));
      setRoomNumber(entry.room_number ?? "");
      setAmountPaid(String(entry.amount_paid));
      setPaymentMode(entry.payment_mode);
      setExpectedCheckOutAt(entry.expected_check_out_at ?? "");
      setNotes(entry.notes ?? "");
    } else {
      setPropertyId(defaultPropertyId || properties[0]?.id || "");
      setGuestName("");
      setPhone("");
      setIdProofType("");
      setIdProofNumber("");
      setNumberOfGuests("1");
      setRoomNumber("");
      setAmountPaid("");
      setPaymentMode("cash");
      setExpectedCheckOutAt("");
      setNotes("");
    }
  }, [open, entry, defaultPropertyId, properties]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSave() {
    if (!guestName.trim() || !propertyId) {
      toast.error("Guest name and property are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        propertyId,
        guestName: guestName.trim(),
        phone: phone.trim() || null,
        idProofType: idProofType.trim() || null,
        idProofNumber: idProofNumber.trim() || null,
        numberOfGuests: parseInt(numberOfGuests, 10) || 1,
        roomNumber: roomNumber.trim() || null,
        amountPaid: parseFloat(amountPaid) || 0,
        paymentMode,
        expectedCheckOutAt: expectedCheckOutAt || null,
        notes: notes.trim() || null,
      };

      const res = entry
        ? await fetch(`/api/front-desk/guest-entries/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/front-desk/guest-entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save guest entry");
        return;
      }
      toast.success(entry ? "Guest entry updated" : "Guest checked in");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[GuestEntryForm] save error:", err);
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/front-desk/guest-entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete guest entry");
        return;
      }
      toast.success("Guest entry deleted");
      setConfirmDelete(false);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[GuestEntryForm] delete error:", err);
      toast.error("Could not reach the server");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-slate-700/50 p-4">
            <SheetTitle className="text-white">
              {entry ? "Edit guest entry" : "New guest check-in"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {properties.length > 1 && (
              <div className="grid gap-2">
                <Label className="text-slate-300">Property</Label>
                {/* Editing an entry can't move it to a different property —
                    the PATCH endpoint doesn't accept propertyId — so lock it
                    to the value it was created with. */}
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  disabled={!!entry}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-slate-300">Guest name</Label>
              <Input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Full name"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Phone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Room number</Label>
                <Input
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="Optional"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">ID proof type</Label>
                <Input
                  value={idProofType}
                  onChange={(e) => setIdProofType(e.target.value)}
                  placeholder="e.g. Aadhaar, Passport"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">ID proof number</Label>
                <Input
                  value={idProofNumber}
                  onChange={(e) => setIdProofNumber(e.target.value)}
                  placeholder="Optional"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Number of guests</Label>
                <Input
                  type="number"
                  min={1}
                  value={numberOfGuests}
                  onChange={(e) => setNumberOfGuests(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Expected checkout</Label>
                <Input
                  type="date"
                  value={expectedCheckOutAt}
                  onChange={(e) => setExpectedCheckOutAt(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Amount paid</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="0"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Payment mode</Label>
                <Select
                  value={paymentMode}
                  onValueChange={(v) => v && setPaymentMode(v as FrontDeskPaymentMode)}
                >
                  <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-300">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="min-h-[80px] border-slate-700 bg-slate-800 text-white"
              />
            </div>
          </div>

          <div className="border-t border-slate-700/50 bg-slate-900/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !guestName.trim() || !propertyId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : entry ? (
                  "Save Changes"
                ) : (
                  "Check In Guest"
                )}
              </Button>
            </div>

            {entry &&
              canDelete &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Delete this entry?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete entry
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
