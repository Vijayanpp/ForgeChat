import { describe, expect, it } from "vitest";

import { decidePayment, paymentReference, type PaymentRules } from "./decide";
import type { ImageAnalysis } from "./receipt";

const rules: PaymentRules = {
  priceInr: 499,
  payeeAliases: ["askmypalm"],
  offeredAt: "2026-09-30T09:00:00Z",
  now: new Date("2026-09-30T10:00:00Z"),
  maxAgeHours: 72,
  timezone: "Asia/Kolkata",
};

const receipt = (overrides: Partial<ImageAnalysis> = {}): ImageAnalysis => ({
  image_type: "payment_receipt",
  payment_status: "success",
  amount: 499,
  currency: "INR",
  payee_name: "AskMyPalm",
  payee_handle: "razorpay.me/@askmypalm",
  razorpay_payment_id: "",
  utr: "6123 4567 8901",
  paid_at: "2026-09-30T15:20",
  app: "Google Pay",
  edit_suspicion: "none",
  notes: "",
  ...overrides,
});

describe("decidePayment", () => {
  it("verifies a clean screenshot", () => {
    const d = decidePayment(receipt(), rules, { duplicate: false, razorpay: null });
    expect(d).toMatchObject({ status: "verified", verifiedBy: "screenshot", reference: "utr:612345678901", amountPaise: 49_900 });
  });

  it("rejects reused references, failures and short payments", () => {
    expect(decidePayment(receipt(), rules, { duplicate: true, razorpay: null }).status).toBe("rejected");
    expect(decidePayment(receipt({ payment_status: "failed" }), rules, { duplicate: false, razorpay: null }).status).toBe("rejected");
    const low = decidePayment(receipt({ amount: 49 }), rules, { duplicate: false, razorpay: null });
    expect(low.status).toBe("rejected");
    expect(low.customerReason).toContain("₹49");
  });

  it("sends anything uncertain to review", () => {
    const d = decidePayment(
      receipt({ payee_name: "Someone Else", payee_handle: "", edit_suspicion: "low", paid_at: "2026-09-20T10:00" }),
      rules,
      { duplicate: false, razorpay: null },
    );
    expect(d.status).toBe("pending_review");
    expect(d.reasons).toEqual(expect.arrayContaining(["payee_mismatch", "edit_suspicion_low", "paid_before_offer", "receipt_too_old"]));
  });

  it("trusts Razorpay over the screenshot", () => {
    const r = receipt({ razorpay_payment_id: "pay_ABCDEFGHIJ1234", payee_name: "", edit_suspicion: "high" });
    expect(paymentReference(r).providerPaymentId).toBe("pay_ABCDEFGHIJ1234");
    const ok = decidePayment(r, rules, {
      duplicate: false,
      razorpay: { found: true, status: "captured", amountPaise: 49_900, currency: "INR", createdAt: "2026-09-30T09:50:00Z" },
    });
    expect(ok).toMatchObject({ status: "verified", verifiedBy: "razorpay_api" });
    const notPaid = decidePayment(r, rules, {
      duplicate: false,
      razorpay: { found: true, status: "failed", amountPaise: 49_900, currency: "INR", createdAt: "2026-09-30T09:50:00Z" },
    });
    expect(notPaid.status).toBe("rejected");
    expect(decidePayment(r, rules, { duplicate: false, razorpay: { found: false } }).reasons).toContain("razorpay_not_found");
  });
});
