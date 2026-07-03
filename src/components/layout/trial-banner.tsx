"use client";

// Persistent top-of-dashboard notice for two billing states:
//   1. Trial ending soon (last 3 days) — nudge toward picking a plan.
//   2. Read-only (past_due / canceled / expired) — the account can
//      still read the inbox but write-path API routes reject sends/
//      creates with a 402 (see src/lib/billing/limits.ts); this banner
//      is what tells the user *why* before they hit that wall.
//
// Reads billing state straight off `useAuth()` — already fetched as
// part of the profile load, so this renders with no extra round trip.

import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isReadOnlyStatus } from "@/lib/billing/plans";

const TRIAL_WARNING_WINDOW_DAYS = 3;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function TrialBanner() {
  const { account, profileLoading, isOwner } = useAuth();
  if (profileLoading || !account) return null;

  const { subscription_status, trial_ends_at } = account;

  if (subscription_status === "trialing" && trial_ends_at) {
    const daysLeft = daysUntil(trial_ends_at);
    if (daysLeft > TRIAL_WARNING_WINDOW_DAYS) return null;

    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 sm:px-6">
        <span className="flex items-center gap-2">
          <Clock className="size-4 shrink-0" />
          {daysLeft <= 0
            ? "Your free trial has ended."
            : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
        </span>
        {isOwner && (
          <Link
            href="/settings?tab=billing"
            className="shrink-0 font-medium underline hover:text-amber-200"
          >
            Choose a plan
          </Link>
        )}
      </div>
    );
  }

  if (isReadOnlyStatus(subscription_status)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300 sm:px-6">
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          Your account is read-only —{" "}
          {subscription_status === "past_due"
            ? "your last payment failed."
            : "your subscription has ended."}
        </span>
        {isOwner && (
          <Link
            href="/settings?tab=billing"
            className="shrink-0 font-medium underline hover:text-red-200"
          >
            Update billing
          </Link>
        )}
      </div>
    );
  }

  return null;
}
