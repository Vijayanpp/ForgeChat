"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Receipt, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ReportInfo {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  email_to: string;
  emailed_at: string | null;
  notified_at: string | null;
  attempts: number;
  last_error: string | null;
}

interface PaymentItem {
  id: string;
  conversation_id: string;
  status: "verified" | "pending_review" | "rejected";
  verified_by: string | null;
  amount_paise: number | null;
  payee: string | null;
  reference: string | null;
  paid_at: string | null;
  reasons: string[];
  extraction: { app?: string; notes?: string; edit_suspicion?: string } | null;
  created_at: string;
  contacts: { name: string | null; phone: string | null } | null;
  report: ReportInfo | null;
}

const FILTERS = [
  { id: "pending_review", label: "Needs review" },
  { id: "", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
];

const REASON_LABELS: Record<string, string> = {
  razorpay_not_found: "Razorpay has no such payment ID",
  status_unclear: "Success status not clearly shown",
  amount_unreadable: "Amount not readable",
  payee_mismatch: "Receiver name doesn't match",
  no_reference: "No transaction ID / UTR visible",
  edit_suspicion_low: "Possible editing (low)",
  edit_suspicion_high: "Looks edited",
  paid_at_unreadable: "Payment time not readable",
  paid_before_offer: "Paid before the offer was made",
  paid_in_future: "Payment time is in the future",
  receipt_too_old: "Receipt is old",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

function reportLabel(r: ReportInfo | null): { text: string; tone: string } {
  if (!r) return { text: "Not requested yet", tone: "text-slate-500" };
  if (r.status === "completed") return { text: `Sent to ${r.email_to}`, tone: "text-emerald-400" };
  if (r.status === "failed") return { text: `Failed: ${r.last_error ?? "unknown error"}`, tone: "text-red-400" };
  return { text: r.status === "running" ? "Generating…" : `Queued (attempt ${r.attempts})`, tone: "text-amber-400" };
}

export default function PaymentsPage() {
  const [filter, setFilter] = useState("pending_review");
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/ai-agents/payments${filter ? `?status=${filter}` : ""}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Failed to load payments");
        if (!cancelled) {
          setItems(data.payments as PaymentItem[]);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load payments");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  async function act(url: string, body: unknown, key: string, success: string) {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast.success(success);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ai-agents" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft className="size-3" /> AI Agents
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white flex items-center gap-2">
          <Receipt className="size-7 text-primary" />
          Payments &amp; reports
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Payment screenshots sent to your palm-reading agent. Clear payments are verified automatically; anything
          uncertain waits here. Check your Razorpay dashboard or bank app, then approve or reject — the customer is
          messaged on WhatsApp either way.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filter === f.id ? "border-primary bg-primary/15 text-white" : "border-slate-700 text-slate-400 hover:text-white",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {!items && !error ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="size-6 animate-spin mr-2" /> Loading…
        </div>
      ) : items?.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {items?.map((p) => {
            const report = reportLabel(p.report);
            return (
              <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">
                      {p.contacts?.name || "Customer"}{" "}
                      <span className="text-xs text-slate-500">{p.contacts?.phone}</span>
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {p.amount_paise !== null ? `₹${(p.amount_paise / 100).toLocaleString("en-IN")}` : "Amount unknown"}
                      {" · "}
                      {p.payee || "payee unknown"}
                      {p.extraction?.app ? ` · ${p.extraction.app}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Ref: <span className="font-mono">{p.reference ?? "—"}</span> · Paid {fmt(p.paid_at)} · Received{" "}
                      {fmt(p.created_at)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      p.status === "verified" && "bg-emerald-500/15 text-emerald-300",
                      p.status === "pending_review" && "bg-amber-500/15 text-amber-300",
                      p.status === "rejected" && "bg-red-500/15 text-red-300",
                    )}
                  >
                    {p.status === "pending_review" ? "Needs review" : p.status}
                    {p.verified_by ? ` · ${p.verified_by.replace("_", " ")}` : ""}
                  </span>
                </div>

                {p.status === "pending_review" && (
                  <ul className="mt-3 list-disc pl-5 text-xs text-amber-200/90">
                    {p.reasons.map((r) => (
                      <li key={r}>{REASON_LABELS[r] ?? r}</li>
                    ))}
                    {p.extraction?.notes && <li className="text-slate-400">AI note: {p.extraction.notes}</li>}
                  </ul>
                )}

                <p className={cn("mt-3 text-xs", report.tone)}>Report: {report.text}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href="/inbox"
                    className="text-xs text-slate-400 hover:text-white underline underline-offset-2"
                    title="Open the inbox and find this contact to see the screenshot"
                  >
                    View screenshot in inbox
                  </Link>
                  {p.status === "pending_review" && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => act(`/api/ai-agents/payments/${p.id}`, { action: "approve" }, p.id, "Payment approved")}
                      >
                        {busy === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Approve
                      </Button>
                      <Input
                        value={reasons[p.id] ?? ""}
                        onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))}
                        placeholder="Reason shown to customer (optional)"
                        className="h-8 w-64 bg-slate-800 border-slate-700 text-white text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-800 text-red-300"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            `/api/ai-agents/payments/${p.id}`,
                            { action: "reject", reason: reasons[p.id] },
                            p.id,
                            "Payment rejected",
                          )
                        }
                      >
                        <X className="size-3.5" /> Reject
                      </Button>
                    </>
                  )}
                  {p.report?.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-700 text-slate-300"
                      disabled={busy !== null}
                      onClick={() => act(`/api/ai-agents/reports/${p.report!.id}`, {}, p.report!.id, "Report retry queued")}
                    >
                      <RotateCcw className="size-3.5" /> Retry report
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
