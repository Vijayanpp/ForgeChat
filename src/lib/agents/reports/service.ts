import crypto from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";

import type { Geocoder } from "../astrology/geocode";
import type { PaymentService, ReportService } from "../kinds/contract";
import { decidePayment, paymentReference, type PaymentDecision } from "../payments/decide";
import { lookupRazorpayPayment, type RazorpayCredentials } from "../payments/razorpay";
import { hashReportToken, reportAccessToken } from "./token";

interface PaymentRow {
  id: string;
  conversation_id: string;
  status: PaymentDecision["status"];
  verified_by: PaymentDecision["verifiedBy"];
  reference: string | null;
  provider_payment_id: string | null;
  amount_paise: number | null;
  paid_at: string | null;
  reasons: string[] | null;
  extraction: { customer_reason?: string } | null;
}

const PAYMENT_COLUMNS =
  "id, conversation_id, status, verified_by, reference, provider_payment_id, amount_paise, paid_at, reasons, extraction";

function rowToDecision(row: PaymentRow): PaymentDecision {
  return {
    status: row.status,
    verifiedBy: row.verified_by,
    reference: row.reference,
    providerPaymentId: row.provider_payment_id,
    amountPaise: row.amount_paise,
    paidAt: row.paid_at,
    reasons: row.reasons ?? [],
    customerReason:
      row.status === "rejected" ? row.extraction?.customer_reason ?? "this payment could not be accepted" : null,
  };
}

export async function loadRazorpayCredentials(db: SupabaseClient, agentId: string): Promise<RazorpayCredentials | null> {
  const { data } = await db
    .from("ai_agent_secrets")
    .select("razorpay_key_id, razorpay_key_secret_enc")
    .eq("agent_id", agentId)
    .maybeSingle();
  if (!data?.razorpay_key_id || !data.razorpay_key_secret_enc) return null;
  try {
    return { keyId: data.razorpay_key_id as string, keySecret: decrypt(data.razorpay_key_secret_enc as string) };
  } catch (err) {
    console.error("[agents/payments] could not decrypt razorpay secret", agentId, err instanceof Error ? err.message : err);
    return null;
  }
}

export function createPaymentService(db: () => SupabaseClient, fetchImpl: typeof fetch = fetch): PaymentService {
  return {
    async check({ agent, refs, screenshotMessageId, analysis, rules }) {
      const client = db();

      if (screenshotMessageId) {
        const { data: seen } = await client
          .from("ai_agent_payments")
          .select(PAYMENT_COLUMNS)
          .eq("account_id", agent.account_id)
          .eq("screenshot_message_id", screenshotMessageId)
          .maybeSingle();
        if (seen) return { decision: rowToDecision(seen as PaymentRow), paymentId: (seen as PaymentRow).id };
      }

      const { reference, providerPaymentId } = paymentReference(analysis);
      if (reference) {
        const { data: prior } = await client
          .from("ai_agent_payments")
          .select(PAYMENT_COLUMNS)
          .eq("account_id", agent.account_id)
          .eq("reference", reference)
          .neq("status", "rejected")
          .limit(1)
          .maybeSingle();
        if (prior) {
          const row = prior as PaymentRow;
          // The same customer re-sending their own screenshot keeps their payment.
          if (row.conversation_id === refs.conversationId) return { decision: rowToDecision(row), paymentId: row.id };
          return insert(client, decidePayment(analysis, rules, { duplicate: true, razorpay: null }));
        }
      }

      const creds = providerPaymentId ? await loadRazorpayCredentials(client, agent.id) : null;
      const razorpay = creds && providerPaymentId ? await lookupRazorpayPayment(creds, providerPaymentId, fetchImpl) : null;
      return insert(client, decidePayment(analysis, rules, { duplicate: false, razorpay }));

      async function insert(c: SupabaseClient, decision: PaymentDecision) {
        const row = {
          account_id: agent.account_id,
          agent_id: agent.id,
          conversation_id: refs.conversationId,
          contact_id: refs.contactId,
          screenshot_message_id: screenshotMessageId,
          status: decision.status,
          verified_by: decision.verifiedBy,
          amount_paise: decision.amountPaise,
          currency: analysis.currency || "INR",
          payee: [analysis.payee_name, analysis.payee_handle].filter(Boolean).join(" · ").slice(0, 200) || null,
          reference: decision.reference,
          provider_payment_id: decision.providerPaymentId,
          paid_at: decision.paidAt,
          extraction: { ...analysis, customer_reason: decision.customerReason },
          reasons: decision.reasons,
        };
        const { data, error } = await c.from("ai_agent_payments").insert(row).select("id").single();
        if (!error) return { decision, paymentId: data.id as string };
        if (error.code !== "23505") throw new Error(`failed to record payment: ${error.message}`);
        // Lost a race with another conversation using the same reference.
        const dup = decidePayment(analysis, rules, { duplicate: true, razorpay: null });
        const retry = await c.from("ai_agent_payments").insert({ ...row, ...decisionColumns(dup) }).select("id").single();
        if (retry.error) throw new Error(`failed to record payment: ${retry.error.message}`);
        return { decision: dup, paymentId: retry.data.id as string };
      }
    },
  };
}

function decisionColumns(d: PaymentDecision) {
  return { status: d.status, verified_by: d.verifiedBy, reasons: d.reasons, extraction: { customer_reason: d.customerReason } };
}

export function createReportService(
  db: () => SupabaseClient,
  geocoder: Geocoder,
  onQueued: () => void = () => {},
): ReportService {
  return {
    resolvePlace: (place) => geocoder.resolve(place),

    async requestReport({ agent, refs, paymentId, subject, palmMediaUrls }) {
      const client = db();
      const existing = await client
        .from("ai_agent_reports")
        .select("id")
        .eq("payment_id", paymentId)
        .eq("account_id", agent.account_id)
        .maybeSingle();
      if (existing.data) return { reportId: existing.data.id as string, created: false };

      const { data: payment } = await client
        .from("ai_agent_payments")
        .select("status")
        .eq("id", paymentId)
        .eq("account_id", agent.account_id)
        .maybeSingle();
      if (payment?.status !== "verified") throw new Error("report requested for a payment that is not verified");

      const id = crypto.randomUUID();
      const { error } = await client.from("ai_agent_reports").insert({
        id,
        account_id: agent.account_id,
        agent_id: agent.id,
        user_id: refs.userId,
        conversation_id: refs.conversationId,
        contact_id: refs.contactId,
        payment_id: paymentId,
        subject,
        palm_media: palmMediaUrls.slice(-4),
        access_token_hash: hashReportToken(reportAccessToken(id)),
        email_to: subject.email,
      });
      if (error) {
        if (error.code !== "23505") throw new Error(`failed to queue report: ${error.message}`);
        const again = await client.from("ai_agent_reports").select("id").eq("payment_id", paymentId).single();
        return { reportId: again.data?.id as string, created: false };
      }
      onQueued();
      return { reportId: id, created: true };
    },
  };
}

export const dryRunPaymentService: PaymentService = {
  async check({ analysis, rules }) {
    return { decision: decidePayment(analysis, rules, { duplicate: false, razorpay: null }), paymentId: "TEST-PAYMENT" };
  },
};

export function dryRunReportService(geocoder: Geocoder): ReportService {
  return {
    resolvePlace: (place) => geocoder.resolve(place),
    async requestReport() {
      return { reportId: "TEST-REPORT", created: false };
    },
  };
}
