"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PLANS,
  TRIAL_DAYS,
  formatInr,
  type BillingInterval,
} from "@/lib/billing/plans";

const plan = PLANS.pro;
const monthsFreeOnYearly = Math.round(
  ((plan.priceMonthlyInr ?? 0) * 12 - (plan.priceYearlyInr ?? 0)) /
    (plan.priceMonthlyInr ?? 1),
);

export function PricingContent() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const price = interval === "monthly" ? plan.priceMonthlyInr : plan.priceYearlyInr;

  return (
    <div className="space-y-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Pricing</h1>
        <p className="mt-2 text-slate-400">
          One plan, every feature. Start with a {TRIAL_DAYS}-day free trial,
          no card required. Prices are in Indian Rupees and billed via
          Razorpay.
        </p>
      </div>

      <div className="mx-auto flex w-fit items-center gap-1 rounded-lg border border-slate-700 p-1 text-sm">
        {(["monthly", "yearly"] as const).map((i) => (
          <button
            key={i}
            onClick={() => setInterval(i)}
            className={`rounded-md px-4 py-1.5 capitalize transition-colors ${
              interval === i
                ? "bg-primary text-primary-foreground"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {i}
            {i === "yearly" && (
              <span className="ml-1.5 text-xs opacity-80">
                Save {monthsFreeOnYearly} months
              </span>
            )}
          </button>
        ))}
      </div>

      <Card className="mx-auto max-w-md border-primary bg-slate-900 ring-1 ring-primary">
        <CardHeader>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{plan.name}</h2>
            <Badge>Full features</Badge>
          </div>
          <p className="text-sm text-slate-400">{plan.tagline}</p>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-4xl font-bold text-white">
              {formatInr(price ?? 0)}
            </span>
            <span className="text-sm text-slate-500">
              /{interval === "monthly" ? "month" : "year"}
            </span>
          </div>
          {interval === "yearly" && (
            <p className="text-xs text-slate-500">
              Billed annually — equivalent to{" "}
              {formatInr(Math.round((plan.priceYearlyInr ?? 0) / 12))}/month.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Link href="/signup" className="block">
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Start free trial
            </Button>
          </Link>
          <ul className="space-y-2 text-sm text-slate-300">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Sign in
        </Link>{" "}
        and go to Settings → Billing to upgrade.
      </p>
    </div>
  );
}
