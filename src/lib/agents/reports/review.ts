import type { SupabaseClient } from "@supabase/supabase-js";

import { engineSendText } from "@/lib/automations/meta-send";

import { parseAgentConfig } from "../kinds/catalog";
import { maskEmail, palmMediaFromSlots, readReportSlots, reportSubject } from "../kinds/palm-report-flow";
import { asRecord } from "../kinds/shared";
import type { RuntimeAgent } from "../types";
import { createOpenMeteoGeocoder } from "../astrology/geocode";
import { scheduleReportDrain } from "./runtime";
import { createReportService } from "./service";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * A team member approves or rejects a payment the bot could not
 * verify. Approval continues the customer's report flow; rejection
 * asks them for a valid screenshot. Either way the customer is told.
 */
export async function reviewPayment(
  db: SupabaseClient,
  args: { accountId: string; reviewerId: string; paymentId: string; action: "approve" | "reject"; reason?: string },
): Promise<{ status: "verified" | "rejected"; reportId: string | null }> {
  const { data: payment } = await db
    .from("ai_agent_payments")
    .select("id, agent_id, conversation_id, contact_id, status, extraction")
    .eq("id", args.paymentId)
    .eq("account_id", args.accountId)
    .maybeSingle();
  if (!payment) throw new ReviewError("Payment not found", 404);
  if (payment.status !== "pending_review") throw new ReviewError(`Payment is already ${payment.status}`, 409);

  const { data: agentRow } = await db
    .from("ai_agents")
    .select("*")
    .eq("id", payment.agent_id ?? "")
    .eq("account_id", args.accountId)
    .maybeSingle();
  const agent = agentRow as RuntimeAgent | null;
  const parsed = agent ? parseAgentConfig("palm_reading", agent.config) : null;
  if (!agent || !parsed?.ok) throw new ReviewError("The agent for this payment is missing or misconfigured", 409);
  const config = parsed.config;

  const reviewed = { reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString() };
  const customerReason = args.reason?.trim().slice(0, 300) || "we could not confirm the payment";
  const { error: updErr } = await db
    .from("ai_agent_payments")
    .update(
      args.action === "approve"
        ? { status: "verified", verified_by: "human", ...reviewed }
        : {
            status: "rejected",
            ...reviewed,
            extraction: { ...asRecord(payment.extraction), customer_reason: customerReason },
          },
    )
    .eq("id", payment.id)
    .eq("status", "pending_review");
  if (updErr) {
    if (updErr.code === "23505") throw new ReviewError("This transaction reference is already used by another payment", 409);
    throw new ReviewError(updErr.message, 500);
  }

  const { data: session } = await db
    .from("ai_agent_sessions")
    .select("id, version, state")
    .eq("conversation_id", payment.conversation_id)
    .eq("account_id", args.accountId)
    .maybeSingle();
  const slots = asRecord(asRecord(session?.state).slots);
  const report = readReportSlots(slots);
  const ownsSession = report.paymentId === payment.id;

  let reportId: string | null = null;
  let text: string;
  let nextReport = report;

  if (args.action === "approve") {
    const subject = reportSubject(report.details, report.place);
    if (ownsSession && report.stage === "waiting_payment" && subject) {
      const service = createReportService(() => db, createOpenMeteoGeocoder(), scheduleReportDrain);
      ({ reportId } = await service.requestReport({
        agent,
        refs: { conversationId: payment.conversation_id, contactId: payment.contact_id, userId: args.reviewerId },
        paymentId: payment.id,
        subject,
        palmMediaUrls: palmMediaFromSlots(slots),
      }));
      nextReport = { ...report, stage: "queued", paymentStatus: "verified", reportId };
      text = `Your payment is verified ✅ Thank you! Your detailed report is being prepared now and will be emailed to ${maskEmail(
        subject.email,
      )} within about 15 minutes.`;
    } else {
      nextReport = ownsSession ? { ...report, paymentStatus: "verified" } : report;
      text =
        report.stage === "confirming"
          ? "Your payment is verified ✅ Thank you! Please reply *YES* to confirm your details and I'll start preparing your report."
          : "Your payment is verified ✅ Thank you! Please share your full name, date of birth, birth time, birth place and email so I can prepare your detailed report.";
    }
  } else {
    nextReport = ownsSession ? { ...report, stage: "offered", paymentId: null, paymentStatus: null } : report;
    text = `Sorry, we couldn't verify your payment — ${customerReason}. If you have paid ₹${config.report_price_inr}${
      config.payment_link ? ` via ${config.payment_link}` : ""
    }, please send a clear screenshot of the successful payment here.`;
  }

  if (session && ownsSession) {
    await db
      .from("ai_agent_sessions")
      .update({
        stage: nextReport.stage === "queued" ? "report_queued" : nextReport.stage === "offered" ? "awaiting_payment" : "collecting_details",
        state: { ...asRecord(session.state), slots: { ...slots, report: nextReport } },
        version: (session.version as number) + 1,
      })
      .eq("id", session.id);
  }

  await engineSendText({
    accountId: args.accountId,
    userId: args.reviewerId,
    conversationId: payment.conversation_id,
    contactId: payment.contact_id,
    text,
    aiAgentId: agent.id,
  });

  return { status: args.action === "approve" ? "verified" : "rejected", reportId };
}
