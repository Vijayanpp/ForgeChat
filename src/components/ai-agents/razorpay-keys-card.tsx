"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const inputClass = "mt-1 bg-slate-800 border-slate-700 text-white";

/** Write-only Razorpay API keys: the secret is encrypted server-side and never shown again. */
export function RazorpayKeysCard({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<{ configured: boolean; keyId: string | null } | null>(null);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/ai-agents/${agentId}/razorpay`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  async function submit(method: "PUT" | "DELETE") {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-agents/${agentId}/razorpay`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ keyId, keySecret }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save keys");
      setStatus(data);
      setKeySecret("");
      toast.success(method === "PUT" ? "Razorpay keys saved" : "Razorpay keys removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save keys");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Razorpay API verification (optional)</h3>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        When a screenshot shows a Razorpay payment ID (pay_…), the agent confirms it directly with Razorpay before
        accepting. Without keys, screenshots are checked visually and anything uncertain goes to{" "}
        <a href="/ai-agents/payments" className="text-amber-400 hover:underline">
          payment review
        </a>
        . Use a key from Razorpay Dashboard → Account &amp; Settings → API Keys.
      </p>
      <p className="mt-3 text-xs text-slate-300">
        Status:{" "}
        {status === null ? "…" : status.configured ? `configured (${status.keyId})` : "not configured"}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-slate-300">Key ID</label>
          <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_…" className={inputClass} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-300">Key secret</label>
          <Input
            type="password"
            autoComplete="off"
            value={keySecret}
            onChange={(e) => setKeySecret(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={busy || !keyId || !keySecret} onClick={() => submit("PUT")}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Save keys
        </Button>
        {status?.configured && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300"
            disabled={busy}
            onClick={() => submit("DELETE")}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
