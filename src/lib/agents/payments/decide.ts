import { localToUtc } from "../astrology/chart";
import type { ImageAnalysis } from "./receipt";

export type PaymentStatus = "verified" | "pending_review" | "rejected";
export type VerifiedBy = "screenshot" | "razorpay_api" | "human";

export interface PaymentRules {
  priceInr: number;
  payeeAliases: string[];
  /** When the payment link was offered; payments made earlier need review. */
  offeredAt: string | null;
  now: Date;
  /** Receipts older than this need review. */
  maxAgeHours: number;
  timezone: string;
}

/** Result of asking Razorpay about a pay_ id. null = no credentials / API unavailable. */
export type RazorpayLookup =
  | { found: true; status: string; amountPaise: number; currency: string; createdAt: string }
  | { found: false }
  | null;

export interface PaymentDecision {
  status: PaymentStatus;
  verifiedBy: VerifiedBy | null;
  reference: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  paidAt: string | null;
  /** Internal reasons (audit / review queue). */
  reasons: string[];
  /** What to tell the customer when rejected. */
  customerReason: string | null;
}

const RAZORPAY_ID = /^pay_[A-Za-z0-9]{14}$/;

export function paymentReference(receipt: Pick<ImageAnalysis, "razorpay_payment_id" | "utr">): {
  reference: string | null;
  providerPaymentId: string | null;
} {
  const pay = receipt.razorpay_payment_id.trim();
  if (RAZORPAY_ID.test(pay)) return { reference: pay, providerPaymentId: pay };
  const utr = receipt.utr.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return { reference: utr.length >= 10 ? `utr:${utr}` : null, providerPaymentId: null };
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function payeeMatches(receipt: Pick<ImageAnalysis, "payee_name" | "payee_handle">, aliases: string[]): boolean {
  const shown = normalise(`${receipt.payee_name} ${receipt.payee_handle}`);
  return aliases.map(normalise).some((a) => a.length >= 3 && shown.includes(a));
}

function parsePaidAt(value: string, timezone: string): Date | null {
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return null;
  const d = localToUtc(m[1], m[2], timezone);
  return Number.isNaN(d.getTime()) ? null : d;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Decide on a payment screenshot. Hard failures the customer can fix are
 * rejected with a reason; anything uncertain goes to human review; auto
 * verification needs every check to pass (or Razorpay to confirm).
 */
export function decidePayment(
  receipt: ImageAnalysis,
  rules: PaymentRules,
  ctx: { duplicate: boolean; razorpay: RazorpayLookup },
): PaymentDecision {
  const { reference, providerPaymentId } = paymentReference(receipt);
  const paidAtDate = parsePaidAt(receipt.paid_at, rules.timezone);
  const base = {
    reference,
    providerPaymentId,
    amountPaise: receipt.amount > 0 ? Math.round(receipt.amount * 100) : null,
    paidAt: paidAtDate?.toISOString() ?? null,
  };
  const reject = (reason: string, customerReason: string): PaymentDecision => ({
    ...base,
    status: "rejected",
    verifiedBy: null,
    reasons: [reason],
    customerReason,
  });

  if (ctx.duplicate) {
    return reject("duplicate_reference", "this payment screenshot has already been used for a report");
  }
  if (receipt.payment_status === "failed") return reject("status_failed", "the payment shows as failed");
  if (receipt.payment_status === "pending") {
    return reject("status_pending", "the payment is still pending — please send the screenshot once it shows as successful");
  }
  if (receipt.amount > 0 && receipt.amount < rules.priceInr) {
    return reject(
      "amount_too_low",
      `the amount paid (${rupees(receipt.amount)}) is less than the report price (${rupees(rules.priceInr)})`,
    );
  }

  if (ctx.razorpay?.found) {
    const api = ctx.razorpay;
    const captured = api.status === "captured" || api.status === "authorized";
    if (!captured) return reject(`razorpay_status_${api.status}`, "Razorpay shows this payment as not completed");
    if (api.amountPaise < rules.priceInr * 100) {
      return reject(
        "razorpay_amount_too_low",
        `the amount paid (${rupees(api.amountPaise / 100)}) is less than the report price (${rupees(rules.priceInr)})`,
      );
    }
    return {
      ...base,
      amountPaise: api.amountPaise,
      paidAt: api.createdAt,
      status: "verified",
      verifiedBy: "razorpay_api",
      reasons: ["razorpay_confirmed"],
      customerReason: null,
    };
  }

  const review: string[] = [];
  if (ctx.razorpay && !ctx.razorpay.found) review.push("razorpay_not_found");
  if (receipt.payment_status !== "success") review.push("status_unclear");
  if (receipt.amount <= 0) review.push("amount_unreadable");
  if (!payeeMatches(receipt, rules.payeeAliases)) review.push("payee_mismatch");
  if (!reference) review.push("no_reference");
  if (receipt.edit_suspicion !== "none") review.push(`edit_suspicion_${receipt.edit_suspicion}`);
  if (!paidAtDate) review.push("paid_at_unreadable");
  else {
    const offered = rules.offeredAt ? new Date(rules.offeredAt).getTime() : null;
    if (offered && paidAtDate.getTime() < offered - 30 * 60_000) review.push("paid_before_offer");
    if (paidAtDate.getTime() > rules.now.getTime() + 10 * 60_000) review.push("paid_in_future");
    if (rules.now.getTime() - paidAtDate.getTime() > rules.maxAgeHours * 3_600_000) review.push("receipt_too_old");
  }

  if (review.length) {
    return { ...base, status: "pending_review", verifiedBy: null, reasons: review, customerReason: null };
  }
  return { ...base, status: "verified", verifiedBy: "screenshot", reasons: ["screenshot_checks_passed"], customerReason: null };
}
