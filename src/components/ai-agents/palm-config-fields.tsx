"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Draft = Record<string, unknown>;

const inputClass = "mt-1 bg-slate-800 border-slate-700 text-white";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

const str = (config: Draft, key: string) => (typeof config[key] === "string" ? (config[key] as string) : "");

export function PalmConfigFields({ config, set }: { config: Draft; set: (patch: Draft) => void }) {
  const paid = config.paid_report_enabled === true;
  const [payeeText, setPayeeText] = useState(() =>
    Array.isArray(config.payee_names) ? (config.payee_names as string[]).join(", ") : "",
  );
  const freeReadings = Number(config.upsell_after_readings ?? 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Paid reading packs</p>
          <p className="text-xs text-slate-400">
            After the free answers, the agent sends your payment link, checks the payment screenshot, unlocks more
            readings, then offers the same pack again.
          </p>
        </div>
        <Switch checked={paid} onCheckedChange={(checked) => set({ paid_report_enabled: checked })} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Free answers"
          hint={paid ? "Palm photos and follow-up questions before the paid pack is offered." : undefined}
        >
          <Input
            type="number"
            min={0}
            max={10}
            value={freeReadings}
            onChange={(e) =>
              set({ upsell_after_readings: Math.max(0, Math.min(10, Math.round(Number(e.target.value)))) })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Paid offer name">
          <Input
            value={str(config, "offer_name")}
            onChange={(e) => set({ offer_name: e.target.value })}
            placeholder="5 more palm readings"
            className={inputClass}
          />
        </Field>

        {paid ? (
          <>
            <Field label="Pack price (₹)">
              <Input
                type="number"
                min={1}
                value={Number(config.report_price_inr ?? 50)}
                onChange={(e) => set({ report_price_inr: Math.max(1, Math.round(Number(e.target.value))) })}
                className={inputClass}
              />
            </Field>
            <Field label="Readings per pack">
              <Input
                type="number"
                min={1}
                max={20}
                value={Number(config.pack_size ?? 5)}
                onChange={(e) => set({ pack_size: Math.max(1, Math.min(20, Math.round(Number(e.target.value)))) })}
                className={inputClass}
              />
            </Field>
            <Field label="Payment link" hint="Your Razorpay.me or payment page link.">
              <Input
                value={str(config, "payment_link")}
                onChange={(e) => set({ payment_link: e.target.value })}
                placeholder="razorpay.me/@askmypalm"
                className={inputClass}
              />
            </Field>
            <Field
              label="Payee names on receipts"
              hint="Comma separated. The name customers see as the receiver in GPay/PhonePe/Paytm. Your payment-link handle is included automatically."
            >
              <Input
                value={payeeText}
                onChange={(e) => {
                  setPayeeText(e.target.value);
                  set({
                    payee_names: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.length >= 3),
                  });
                }}
                placeholder="Askmypalm, Your Legal Name"
                className={inputClass}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Price">
              <Input
                value={str(config, "offer_price")}
                onChange={(e) => set({ offer_price: e.target.value })}
                placeholder="₹50"
                className={inputClass}
              />
            </Field>
            <Field label="Offer link (https)">
              <Input
                value={str(config, "offer_link")}
                onChange={(e) => set({ offer_link: e.target.value })}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}
