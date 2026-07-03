"use client";

// ============================================================
// BillingTab — Settings → Billing
//
// Shows the account's current plan, trial/renewal countdown, and
// usage vs plan limits to every member. Only the owner can start a
// new subscription (Razorpay Checkout) or cancel the current one —
// mirrors the owner-only billing capability described in PRODUCT.md.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  PLANS,
  formatInr,
  type BillingInterval,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";
import type { UsageCounts, LimitResource } from "@/lib/billing/limits";

interface BillingStatus {
  plan: { id: PlanId; name: string; limits: Record<LimitResource, number | null> };
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  has_subscription: boolean;
  usage: UsageCounts;
}

const STATUS_BADGE: Record<SubscriptionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trialing: { label: "Trial", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  past_due: { label: "Payment overdue", variant: "destructive" },
  canceled: { label: "Canceled", variant: "outline" },
  expired: { label: "Expired", variant: "destructive" },
};

const USAGE_ROWS: { key: LimitResource; label: string }[] = [
  { key: "seats", label: "Team seats" },
  { key: "contacts", label: "Contacts" },
  { key: "broadcastsPerMonth", label: "Broadcasts this month" },
  { key: "automations", label: "Automations" },
  { key: "flows", label: "Flows" },
  { key: "aiAgents", label: "AI reply agents" },
];

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

export function BillingTab() {
  const { isOwner, profile } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [subscribingPlan, setSubscribingPlan] = useState<PlanId | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/status");
      if (!res.ok) throw new Error("Failed to load billing status");
      setStatus(await res.json());
    } catch {
      toast.error("Failed to load billing status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleSubscribe(planId: PlanId) {
    setSubscribingPlan(planId);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start checkout");
        return;
      }

      await loadRazorpayCheckout();
      const razorpay = new window.Razorpay!({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "ForgeChat",
        description: `${PLANS[planId].name} plan — ${interval}`,
        prefill: { email: profile?.email ?? undefined, name: profile?.full_name ?? undefined },
        theme: { color: "#22c55e" },
        handler: () => {
          toast.success(
            "Payment authorized. Your plan updates within a few seconds once Razorpay confirms it.",
          );
          // The webhook applies the real state change; poll once shortly
          // after so the tab reflects it without a manual refresh.
          setTimeout(loadStatus, 4000);
        },
      });
      razorpay.open();
    } catch {
      toast.error("Failed to start checkout");
    } finally {
      setSubscribingPlan(null);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to cancel subscription");
        return;
      }
      toast.success("Your subscription will not renew after the current period.");
      setConfirmingCancel(false);
      loadStatus();
    } catch {
      toast.error("Failed to cancel subscription");
    } finally {
      setCanceling(false);
    }
  }

  if (loading || !status) {
    return (
      <section className="mt-4 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="size-4 animate-spin" />
        Loading billing status...
      </section>
    );
  }

  const badge = STATUS_BADGE[status.subscription_status];

  return (
    <section className="mt-4 space-y-4">
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <CreditCard className="size-4 text-primary" />
            {status.plan.name} plan
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardTitle>
          <CardDescription className="text-slate-400">
            {status.subscription_status === "trialing" && status.trial_ends_at && (
              <>Your free trial ends in {daysUntil(status.trial_ends_at)} day(s).</>
            )}
            {status.subscription_status === "active" && status.current_period_end && (
              <>Renews on {new Date(status.current_period_end).toLocaleDateString()}.</>
            )}
            {status.subscription_status === "past_due" &&
              "Your last payment failed. Update your payment method to avoid losing access."}
            {(status.subscription_status === "canceled" ||
              status.subscription_status === "expired") &&
              "Your account is read-only. Subscribe to a plan to regain full access."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {USAGE_ROWS.map(({ key, label }) => {
            const used = status.usage[key];
            const limit = status.plan.limits[key];
            const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{label}</span>
                  <span>{limit === null ? `${used} / Unlimited` : `${used} / ${limit}`}</span>
                </div>
                {limit !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!isOwner && (
        <p className="text-xs text-slate-500">
          Only the account owner can change or cancel the subscription.
        </p>
      )}

      {isOwner &&
        (() => {
          const proPlan = PLANS.pro;
          const price =
            interval === "monthly" ? proPlan.priceMonthlyInr : proPlan.priceYearlyInr;
          const isCurrent = status.plan.id === "pro" && status.has_subscription;
          return (
            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between space-y-0">
                <div>
                  <CardTitle className="text-white">
                    {status.has_subscription ? "Change billing interval" : "Subscribe"}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Billed in INR via Razorpay.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-1 text-xs">
                  {(["monthly", "yearly"] as const).map((i) => (
                    <button
                      key={i}
                      onClick={() => setInterval(i)}
                      className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                        interval === i
                          ? "bg-primary text-primary-foreground"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-700 p-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-medium text-white">{proPlan.name} plan</p>
                    <p className="text-sm text-slate-400">
                      {formatInr(price ?? 0)}/{interval === "monthly" ? "mo" : "yr"} — full
                      access, no limits
                    </p>
                  </div>
                  <Button
                    disabled={isCurrent || subscribingPlan !== null}
                    onClick={() => handleSubscribe("pro")}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {subscribingPlan === "pro" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : isCurrent ? (
                      "Current plan"
                    ) : (
                      "Subscribe"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}

      {isOwner && status.has_subscription && status.subscription_status === "active" && (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Cancel subscription</CardTitle>
            <CardDescription className="text-slate-400">
              You&apos;ll keep access until the end of the current billing period —
              no partial refund.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {confirmingCancel ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={canceling}
                  onClick={handleCancel}
                >
                  {canceling ? <Loader2 className="size-4 animate-spin" /> : "Yes, cancel"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={canceling}
                  onClick={() => setConfirmingCancel(false)}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Never mind
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingCancel(true)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel subscription
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
