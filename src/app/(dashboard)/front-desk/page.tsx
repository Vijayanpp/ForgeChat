"use client";

// ============================================================
// Front Desk dashboard — ONE adaptive page (not separate admin/
// receptionist pages) that renders differently based on the
// caller's resolved permission context. See
// src/lib/front-desk/permissions.ts for how that context is
// derived server-side; this page just trusts whatever the
// guest-entries API decided to include in its response.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  IndianRupee,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { ReportStatCard } from "@/components/reports/report-stat-card";
import { ExportCsv } from "@/components/reports/export-csv";
import { GuestEntryForm } from "@/components/front-desk/guest-entry-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  FrontDeskGuestEntry,
  FrontDeskHistoryScope,
  FrontDeskProperty,
} from "@/types";

interface GuestEntriesResponse {
  entries?: FrontDeskGuestEntry[];
  summary?: {
    guestCount: number;
    bookingCount: number;
    totalAmount: number;
    byPaymentMode: Record<string, number>;
  };
  historyScope: FrontDeskHistoryScope;
  canViewGuestDetails: boolean;
  canViewCashTotal: boolean;
  canManageEntries: boolean;
  canExport: boolean;
}

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

function formatCurrency(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FrontDeskPage() {
  const { account, loading: authLoading } = useAuth();

  const [properties, setProperties] = useState<FrontDeskProperty[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [data, setData] = useState<GuestEntriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FrontDeskGuestEntry | null>(null);

  const loadProperties = useCallback(async () => {
    try {
      const res = await fetch("/api/front-desk/properties");
      if (!res.ok) return;
      const json = await res.json();
      setProperties(((json.properties ?? []) as FrontDeskProperty[]).filter((p) => p.is_active));
    } catch (err) {
      console.error("[FrontDeskPage] properties load error:", err);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const params = new URLSearchParams();
      if (selectedPropertyId !== "all") params.set("propertyId", selectedPropertyId);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());

      const res = await fetch(`/api/front-desk/guest-entries?${params.toString()}`);
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        toast.error("Failed to load Front Desk data");
        return;
      }
      const json = (await res.json()) as GuestEntriesResponse;
      setData(json);
    } catch (err) {
      console.error("[FrontDeskPage] entries load error:", err);
      toast.error("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, from, to]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  function openNewEntry() {
    setEditingEntry(null);
    setFormOpen(true);
  }

  function openEditEntry(entry: FrontDeskGuestEntry) {
    setEditingEntry(entry);
    setFormOpen(true);
  }

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (forbidden || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-6 py-16 text-center">
        <Lock className="h-8 w-8 text-slate-600" />
        <h2 className="text-lg font-semibold text-white">No Front Desk access</h2>
        <p className="max-w-sm text-sm text-slate-400">
          {account?.front_desk_enabled
            ? "You haven't been granted access to the Front Desk module. Ask an account admin to grant it from Settings."
            : "The Front Desk module isn't enabled for this account yet. An admin can turn it on from Settings."}
        </p>
      </div>
    );
  }

  const showDateRange = data.historyScope === "full_history";
  const showPropertySwitcher = properties.length > 1;

  const exportRows = (data.entries ?? []).map((e) => ({
    guest_name: e.guest_name,
    phone: e.phone ?? "",
    room_number: e.room_number ?? "",
    number_of_guests: e.number_of_guests,
    amount_paid: e.amount_paid,
    payment_mode: e.payment_mode,
    check_in_at: e.check_in_at,
    expected_check_out_at: e.expected_check_out_at ?? "",
    notes: e.notes ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Front Desk</h1>
          <p className="text-sm text-slate-400">
            {data.historyScope === "today_only" ? "Today's check-ins" : "Guest check-in log"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showPropertySwitcher && (
            <Select
              value={selectedPropertyId}
              onValueChange={(v) => v && setSelectedPropertyId(v)}
            >
              <SelectTrigger className="min-w-[160px] bg-slate-900 border-slate-700 text-slate-200">
                <Building2 className="h-4 w-4 text-slate-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {showDateRange && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-[140px] border-slate-700 bg-slate-900 text-slate-200"
              />
              <span className="text-sm text-slate-500">to</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-[140px] border-slate-700 bg-slate-900 text-slate-200"
              />
            </div>
          )}

          {data.canExport && (
            <ExportCsv data={exportRows} filename="front-desk-guests" />
          )}

          {data.canManageEntries && (
            <Button onClick={openNewEntry} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New guest
            </Button>
          )}
        </div>
      </div>

      {data.canViewCashTotal && data.summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReportStatCard
            title="Guests checked in"
            value={data.summary.guestCount.toLocaleString()}
            icon={Users}
          />
          <ReportStatCard
            title="Total bookings"
            value={data.summary.bookingCount.toLocaleString()}
            icon={Building2}
          />
          <ReportStatCard
            title="Total cash collected"
            value={formatCurrency(data.summary.totalAmount)}
            icon={IndianRupee}
          />
          <ReportStatCard
            title="By payment mode"
            value={
              Object.keys(data.summary.byPaymentMode).length > 0
                ? formatCurrency(
                    data.summary.byPaymentMode.cash ??
                      Object.values(data.summary.byPaymentMode)[0] ??
                      0,
                  )
                : "—"
            }
            subtitle={
              Object.entries(data.summary.byPaymentMode)
                .map(([mode, amt]) => `${PAYMENT_MODE_LABELS[mode] ?? mode}: ${formatCurrency(amt)}`)
                .join(" · ") || "No entries yet"
            }
            icon={IndianRupee}
          />
        </div>
      )}

      {data.canViewGuestDetails ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {(data.entries ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Users className="h-8 w-8 text-slate-600" />
              <p className="text-sm text-slate-400">No guest check-ins yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Guest</th>
                    <th className="px-4 py-3">Room</th>
                    <th className="px-4 py-3">Guests</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3">Checked in</th>
                    {data.canManageEntries && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {(data.entries ?? []).map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{entry.guest_name}</div>
                        {entry.phone && (
                          <div className="text-xs text-slate-500">{entry.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{entry.room_number || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{entry.number_of_guests}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">
                        {formatCurrency(entry.amount_paid)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {PAYMENT_MODE_LABELS[entry.payment_mode] ?? entry.payment_mode}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDateTime(entry.check_in_at)}
                      </td>
                      {data.canManageEntries && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditEntry(entry)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : !data.canViewCashTotal ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 py-16 text-center">
          <Lock className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">
            You don&apos;t have permission to view Front Desk data yet.
          </p>
        </div>
      ) : null}

      <GuestEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        entry={editingEntry}
        properties={properties}
        defaultPropertyId={selectedPropertyId !== "all" ? selectedPropertyId : undefined}
        canDelete={data.canManageEntries}
        onSaved={loadEntries}
      />
    </div>
  );
}
