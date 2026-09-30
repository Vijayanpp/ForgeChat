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
          <p className="text-sm font-medium text-white">Paid detailed report</p>
          <p className="text-xs text-slate-400">
            After the free readings, the agent sends your payment link, checks the payment screenshot, collects birth
            details and emails a full Vedic astrology + palm report.
          </p>
        </div>
        <Switch checked={paid} onCheckedChange={(checked) => set({ paid_report_enabled: checked })} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Free readings" hint={paid ? "Readings before the report is offered." : undefined}>
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
            placeholder="Personalized Vedic Astrology & Palm Report"
            className={inputClass}
          />
        </Field>

        {paid ? (
          <>
            <Field label="Report price (₹)">
              <Input
                type="number"
                min={1}
                value={Number(config.report_price_inr ?? 499)}
                onChange={(e) => set({ report_price_inr: Math.max(1, Math.round(Number(e.target.value))) })}
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
            <Field label="Report writing model" hint="Used for the long report. gpt-4o recommended.">
              <Input
                value={str(config, "report_model") || "gpt-4o"}
                onChange={(e) => set({ report_model: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Send report from" hint="A verified sender on your domain, e.g. AskMyPalm <reports@askmypalm.com>. Empty uses REPORT_EMAIL_FROM.">
              <Input
                value={str(config, "report_email_from")}
                onChange={(e) => set({ report_email_from: e.target.value })}
                placeholder="AskMyPalm <reports@yourdomain.com>"
                className={inputClass}
              />
            </Field>
            <Field label="Reply-to email">
              <Input
                value={str(config, "report_reply_to")}
                onChange={(e) => set({ report_reply_to: e.target.value })}
                placeholder="support@yourdomain.com"
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
                placeholder="₹499"
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
