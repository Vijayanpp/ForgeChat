import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { latestCustomerText, toLangChainMessages, transcriptToText } from "../llm/context";
import { personaSystemPrompt, withStyle } from "../llm/prompts";
import { analyzeCustomerImage } from "../payments/receipt";
import { addUsage, ZERO_USAGE, type ChatTurn, type Usage } from "../types";
import type { PalmReadingConfig } from "./catalog";
import type { SpecialistContext, SpecialistResult, Specialist } from "./contract";
import {
  decideDetailsAction,
  DETAIL_LABELS,
  detailsSummary,
  maskEmail,
  missingDetails,
  normaliseDetail,
  palmMediaFromSlots,
  readReportSlots,
  reportSubject,
  type BirthDetails,
  type ReportSlots,
} from "./palm-report-flow";
import { asRecord, controlSpec, replySpec } from "./shared";

type PalmMode = "request_photo" | "reading" | "follow_up";

export interface PalmPlan {
  mode: PalmMode;
  offerNow: boolean;
  readingsAfter: number;
}

/** Pure stage decision, separated for testing. */
export function planPalmTurn(args: {
  hasNewPhoto: boolean;
  readingsGiven: number;
  offerMade: boolean;
  upsellAfterReadings: number;
}): PalmPlan {
  const mode: PalmMode = args.hasNewPhoto
    ? "reading"
    : args.readingsGiven === 0
      ? "request_photo"
      : "follow_up";
  const readingsAfter = args.readingsGiven + (mode === "reading" ? 1 : 0);
  const offerNow =
    !args.offerMade && mode !== "request_photo" && args.readingsGiven >= args.upsellAfterReadings;
  return { mode, offerNow, readingsAfter };
}

const MODE_INSTRUCTIONS: Record<PalmMode, string> = {
  request_photo:
    "You don't have a palm photo yet. Respond warmly to what they said and ask for a clear, well-lit photo of their dominant palm, fingers slightly apart.",
  reading:
    "The customer just sent a palm photo. Look at it carefully. First describe 2-3 specific features you can actually see (heart line, head line, life line, fate line, mounts), then give a warm, personal reading of what they suggest. If the photo is unclear or not a palm, say so kindly and ask for a better one.",
  follow_up:
    "Continue the conversation naturally, building on the reading already given. Answer their question in the persona's voice.",
};

const SAFETY = "\n[Never make medical, legal or financial predictions. Present readings as guidance, not certainty.]";

function persona(ctx: SpecialistContext<"palm_reading">): string {
  return personaSystemPrompt({
    personaPrompt: ctx.agent.system_prompt,
    businessName: ctx.config.business_name,
    contactName: ctx.contactName,
  });
}

async function say(
  ctx: SpecialistContext<"palm_reading">,
  instruction: string,
  opts: { vision?: boolean; maxTokens?: number } = {},
): Promise<{ text: string; usage: Usage }> {
  return ctx.llm.chat(
    replySpec(ctx, { vision: opts.vision, maxTokens: opts.maxTokens ?? 500 }),
    [
      new SystemMessage(withStyle(`${persona(ctx)}\n\n[This turn: ${instruction}]${SAFETY}`)),
      ...toLangChainMessages(ctx.transcript, { includeImages: Boolean(opts.vision) }),
    ],
    ctx.runnableConfig,
  );
}

/** The customer's newest image in their latest burst of messages. */
function latestCustomerImageTurn(turns: ChatTurn[]): ChatTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.sender !== "customer") return null;
    if (t.imageDataUrls?.length) return t;
  }
  return null;
}

/** "https://razorpay.me/@askmypalm" → "askmypalm". */
export function payeeAliases(config: PalmReadingConfig): string[] {
  const handle = config.payment_link.match(/@([A-Za-z0-9._-]+)/)?.[1];
  const aliases = [...config.payee_names, ...(handle ? [handle] : []), ...(config.business_name ? [config.business_name] : [])];
  return [...new Set(aliases.map((a) => a.trim()).filter((a) => a.length >= 3))];
}

function offerLine(config: PalmReadingConfig): string {
  return `${config.offer_name || "Detailed personal report"} — ₹${config.report_price_inr}. Payment link: ${
    config.payment_link || "(ask the team for the payment link)"
  }. After paying, they should send the payment screenshot here.`;
}

// ---------------------------------------------------------------- free flow

async function runFreeFlow(ctx: SpecialistContext<"palm_reading">): Promise<SpecialistResult> {
  const { config, transcript } = ctx;
  const slots = asRecord(ctx.session.slots);
  const readingsGiven = Number(slots.readings_given ?? 0) || 0;
  const offerMade = slots.offer_made === true;
  const photo = latestCustomerImageTurn(transcript);

  const plan = planPalmTurn({
    hasNewPhoto: Boolean(photo),
    readingsGiven,
    offerMade,
    upsellAfterReadings: config.upsell_after_readings,
  });

  const offer = [
    config.offer_name,
    config.offer_price ? `(${config.offer_price})` : "",
    config.offer_link ? `— link: ${config.offer_link}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const instruction = `${MODE_INSTRUCTIONS[plan.mode]}${
    plan.offerNow ? `]\n[After giving value, gently introduce the paid offer: ${offer}. One or two sentences, no pressure.` : ""
  }`;
  const { text, usage } = await say(ctx, instruction, {
    vision: plan.mode === "reading",
    maxTokens: plan.mode === "reading" ? 900 : 500,
  });

  return {
    reply: text,
    usage,
    steps: [`palm:${plan.mode}`, ...(plan.offerNow ? ["palm:offer"] : [])],
    session: {
      stage: plan.offerNow ? "offer_made" : plan.mode === "request_photo" ? "awaiting_photo" : "reading_given",
      slots: { ...slots, readings_given: plan.readingsAfter, offer_made: offerMade || plan.offerNow },
    },
  };
}

// ---------------------------------------------------------------- paid flow

const detailsSchema = z.object({
  full_name: z.string().describe("Full name as the customer wrote it, else empty"),
  date_of_birth: z.string().describe("YYYY-MM-DD, else empty"),
  birth_time: z.string().describe("24h HH:MM, or 'unknown' if they say they don't know it, else empty"),
  birth_place: z.string().describe("Town/city with district/state/country as given, else empty"),
  email: z.string().describe("Email address, else empty"),
  confirmation: z
    .enum(["yes", "no", "none"])
    .describe("yes/no only if the LATEST message answers a request to confirm the details summary"),
});

interface PaidState {
  slots: Record<string, unknown>;
  report: ReportSlots;
  readingsGiven: number;
  palmMedia: string[];
}

function paidResult(
  state: PaidState,
  out: { reply: string | null; usage: Usage; steps: string[]; stage: string; handoff?: boolean },
): SpecialistResult {
  return {
    reply: out.reply,
    handoff: out.handoff,
    usage: out.usage,
    steps: out.steps,
    session: {
      stage: out.stage,
      slots: {
        ...state.slots,
        readings_given: state.readingsGiven,
        offer_made: state.report.stage !== "none",
        palm_media: state.palmMedia.slice(-4),
        report: state.report,
      },
    },
  };
}

async function handlePaymentScreenshot(
  ctx: SpecialistContext<"palm_reading">,
  state: PaidState,
  analysis: Awaited<ReturnType<typeof analyzeCustomerImage>>["data"],
  imageTurn: ChatTurn,
  usage: Usage,
): Promise<SpecialistResult> {
  const { config } = ctx;
  const refs = ctx.refs ?? { conversationId: ctx.conversationKey, contactId: "", userId: "" };
  const { decision, paymentId } = await ctx.services.payments.check({
    agent: ctx.agent,
    refs,
    screenshotMessageId: imageTurn.messageId ?? null,
    analysis,
    rules: {
      priceInr: config.report_price_inr,
      payeeAliases: payeeAliases(config),
      offeredAt: state.report.offeredAt,
      now: ctx.now,
      maxAgeHours: 72,
      timezone: "Asia/Kolkata",
    },
  });
  const steps = [`palm:payment:${decision.status}`];

  if (decision.status === "rejected") {
    const rejections = state.report.rejections + 1;
    state.report = { ...state.report, stage: "offered", rejections };
    if (rejections >= 3) {
      return paidResult(state, { reply: null, handoff: true, usage, steps: [...steps, "palm:payment:handoff"], stage: "payment_issue" });
    }
    const r = await say(
      ctx,
      `The customer sent a payment screenshot but it can't be accepted because ${decision.customerReason}. Explain this kindly in one or two sentences and ask them to send a clear screenshot of a successful payment of ₹${config.report_price_inr} made via ${config.payment_link}. Do not accuse them of anything.`,
    );
    return paidResult(state, { reply: r.text, usage: addUsage(usage, r.usage), steps, stage: "awaiting_payment" });
  }

  state.report = {
    ...state.report,
    stage: "collecting",
    paymentId,
    paymentStatus: decision.status,
  };
  const ask = (Object.keys(DETAIL_LABELS) as (keyof BirthDetails)[])
    .filter((k) => !state.report.details[k])
    .map((k, i) => `${i + 1}. ${DETAIL_LABELS[k]}`)
    .join("\n");
  const instruction =
    decision.status === "verified"
      ? `Payment is confirmed ✅. Thank them warmly. To prepare their detailed Vedic astrology + palm report, ask them to share (numbered, in one message):\n${ask}\nSay they can send it all in one message.`
      : `Thank them for the payment screenshot. Say the team is verifying the payment and it usually doesn't take long. Meanwhile, to prepare their detailed report, ask them to share (numbered, in one message):\n${ask}`;
  const r = await say(ctx, instruction);
  return paidResult(state, { reply: r.text, usage: addUsage(usage, r.usage), steps, stage: "collecting_details" });
}

async function handleDetails(ctx: SpecialistContext<"palm_reading">, state: PaidState): Promise<SpecialistResult> {
  const { transcript } = ctx;
  let usage = ZERO_USAGE;
  const steps: string[] = [];
  const report = state.report;
  const details: BirthDetails = { ...report.details };
  let place = report.place;
  let changed = false;
  let confirmation: "yes" | "no" | "none" = "none";
  const invalid: string[] = [];
  const today = ctx.now.toISOString().slice(0, 10);

  if (latestCustomerText(transcript)) {
    const extracted = await ctx.llm.structured(
      controlSpec(ctx),
      detailsSchema,
      "report_details_extract",
      [
        new SystemMessage(
          `Extract birth details the customer has stated for their palm/astrology report. Today is ${today}. Convert dates like 17/12/2010 (day first, Indian style) to YYYY-MM-DD and times like "1:56 pm" to 13:56. Only include values clearly stated; leave others empty.\nCurrent details: ${JSON.stringify(details)}\nWaiting for confirmation of a summary: ${report.stage === "confirming" ? "yes" : "no"}`,
        ),
        new HumanMessage(transcriptToText(transcript, 8)),
      ],
      ctx.runnableConfig,
    );
    usage = addUsage(usage, extracted.usage);
    steps.push("palm:details_extract");
    confirmation = extracted.data.confirmation;

    for (const key of Object.keys(DETAIL_LABELS) as (keyof BirthDetails)[]) {
      const raw = extracted.data[key];
      if (!raw?.trim()) continue;
      const value = normaliseDetail(key, raw, ctx.now);
      if (value === null) {
        invalid.push(DETAIL_LABELS[key]);
      } else if (details[key] !== value) {
        details[key] = value;
        changed = true;
        if (key === "birth_place") place = null;
      }
    }
  }

  if (details.birth_place && !place) {
    place = await ctx.services.reports.resolvePlace(details.birth_place);
    steps.push(place ? "palm:place_resolved" : "palm:place_unknown");
    if (!place) {
      invalid.push(`birth place ("${details.birth_place}" couldn't be found — please add the district and state)`);
      delete details.birth_place;
    }
  }

  const missing = missingDetails(details);
  const action = decideDetailsAction({
    stage: report.stage,
    complete: missing.length === 0,
    changed,
    confirmation,
    paymentVerified: report.paymentStatus === "verified",
  });
  steps.push(`palm:details:${action}`);
  state.report = { ...report, details, place };

  if (action === "ask_missing") {
    state.report.stage = "collecting";
    const r = await say(
      ctx,
      `You are collecting details for their paid report. ${
        invalid.length ? `These need correcting: ${invalid.join("; ")}. ` : ""
      }Still needed (ask for all of them, numbered, in one short message): ${missing.map((k) => DETAIL_LABELS[k]).join(", ")}.`,
    );
    return paidResult(state, { reply: r.text, usage: addUsage(usage, r.usage), steps, stage: "collecting_details" });
  }

  if (action === "confirm") {
    state.report.stage = "confirming";
    const intro = await say(
      ctx,
      "Write ONE short friendly sentence introducing a summary of their report details for them to check. Do not list the details yourself.",
      { maxTokens: 120 },
    );
    return paidResult(state, {
      reply: `${intro.text}\n\n${detailsSummary(details, place)}\n\nReply *YES* to confirm, or tell me what to change.`,
      usage: addUsage(usage, intro.usage),
      steps,
      stage: "confirming_details",
    });
  }

  if (action === "wait_payment") {
    state.report.stage = "waiting_payment";
    const r = await say(
      ctx,
      "Their details are saved. The payment is still being verified by the team. Tell them that as soon as it's confirmed, their report will be prepared and emailed, and they'll get a message here. Keep it to two sentences.",
    );
    return paidResult(state, { reply: r.text, usage: addUsage(usage, r.usage), steps, stage: "waiting_payment" });
  }

  const { reportId } = await ctx.services.reports.requestReport({
    agent: ctx.agent,
    refs: ctx.refs ?? { conversationId: ctx.conversationKey, contactId: "", userId: "" },
    paymentId: report.paymentId!,
    subject: reportSubject(details, place)!,
    palmMediaUrls: state.palmMedia,
  });
  state.report = { ...state.report, stage: "queued", reportId };
  const r = await say(
    ctx,
    `Their details are confirmed and their personalized Vedic astrology + palm report is now being prepared. Tell them it will be emailed to ${maskEmail(
      details.email!,
    )} within about 15 minutes and you'll send a message here when it's sent. Warm, two sentences.`,
  );
  return paidResult(state, { reply: r.text, usage: addUsage(usage, r.usage), steps: [...steps, "palm:report_requested"], stage: "report_queued" });
}

async function runPaidFlow(ctx: SpecialistContext<"palm_reading">): Promise<SpecialistResult> {
  const { config, transcript } = ctx;
  const slots = asRecord(ctx.session.slots);
  const state: PaidState = {
    slots,
    report: readReportSlots(slots),
    readingsGiven: Number(slots.readings_given ?? 0) || 0,
    palmMedia: palmMediaFromSlots(slots),
  };
  const limit = config.upsell_after_readings;
  const imageTurn = latestCustomerImageTurn(transcript);
  const photo = imageTurn?.imageDataUrls?.[0] ?? null;

  if (state.report.stage === "queued") {
    const r = await say(
      ctx,
      `Their paid report has already been requested and is being prepared or has been emailed to ${maskEmail(
        state.report.details.email ?? "",
      )}. Answer their message warmly. If they say they did not receive it after a while, ask them to check spam/promotions and say the team will help.`,
    );
    return paidResult(state, { reply: r.text, usage: r.usage, steps: ["palm:report_status"], stage: "report_queued" });
  }
  if (state.report.stage === "collecting" || state.report.stage === "confirming" || state.report.stage === "waiting_payment") {
    return handleDetails(ctx, state);
  }

  const paidPhase = state.report.stage === "offered" || state.readingsGiven >= limit;

  if (photo && imageTurn && paidPhase) {
    const analysis = await analyzeCustomerImage(ctx.llm, replySpec(ctx, { vision: true, maxTokens: 500 }), photo, ctx.runnableConfig);
    const steps = [`palm:image:${analysis.data.image_type}`];
    if (analysis.data.image_type === "payment_receipt") {
      const result = await handlePaymentScreenshot(ctx, state, analysis.data, imageTurn, analysis.usage);
      return { ...result, steps: [...steps, ...result.steps] };
    }
    if (state.report.stage === "none") state.report = { ...state.report, stage: "offered", offeredAt: ctx.now.toISOString() };
    const r = await say(
      ctx,
      analysis.data.image_type === "palm"
        ? `They sent another palm photo, but their ${limit} free readings are complete. Do not give a new reading. Kindly explain, and invite them to the detailed personalized report: ${offerLine(config)}`
        : `The image doesn't look like a palm photo or a payment screenshot. Ask kindly what they meant. If they have paid, ask for the payment screenshot. Offer: ${offerLine(config)}`,
    );
    return paidResult(state, { reply: r.text, usage: addUsage(analysis.usage, r.usage), steps, stage: "awaiting_payment" });
  }

  if (photo && imageTurn) {
    state.readingsGiven += 1;
    if (imageTurn.mediaUrl) state.palmMedia = [...state.palmMedia.filter((m) => m !== imageTurn.mediaUrl), imageTurn.mediaUrl];
    const offerNow = state.readingsGiven >= limit;
    const remaining = Math.max(0, limit - state.readingsGiven);
    if (offerNow) state.report = { ...state.report, stage: "offered", offeredAt: ctx.now.toISOString() };
    const r = await say(
      ctx,
      `${MODE_INSTRUCTIONS.reading} This is free reading ${state.readingsGiven} of ${limit}.${
        offerNow
          ? `]\n[This was their last free reading. After the reading, introduce the detailed personalized Vedic astrology + palm report (a complete multi-chapter report emailed to them): ${offerLine(config)}`
          : ` They have ${remaining} free reading${remaining === 1 ? "" : "s"} left; they can send another palm photo (e.g. the other hand) or ask a question.`
      }`,
      { vision: true, maxTokens: 900 },
    );
    return paidResult(state, {
      reply: r.text,
      usage: r.usage,
      steps: ["palm:reading", ...(offerNow ? ["palm:offer"] : [])],
      stage: offerNow ? "awaiting_payment" : "reading_given",
    });
  }

  if (state.readingsGiven === 0 && state.report.stage === "none") {
    const r = await say(ctx, MODE_INSTRUCTIONS.request_photo);
    return paidResult(state, { reply: r.text, usage: r.usage, steps: ["palm:request_photo"], stage: "awaiting_photo" });
  }

  const offerNow = state.report.stage === "none" && state.readingsGiven >= limit;
  if (offerNow) state.report = { ...state.report, stage: "offered", offeredAt: ctx.now.toISOString() };
  const r = await say(
    ctx,
    state.report.stage === "offered"
      ? `${MODE_INSTRUCTIONS.follow_up} Their free readings are complete${
          offerNow ? "; introduce" : "; if relevant, remind them of"
        } the detailed report: ${offerLine(config)} If they say they've paid, ask for the payment screenshot — never treat their words alone as proof of payment.`
      : `${MODE_INSTRUCTIONS.follow_up} They have ${limit - state.readingsGiven} free reading(s) left and can send another palm photo.`,
  );
  return paidResult(state, {
    reply: r.text,
    usage: r.usage,
    steps: ["palm:follow_up", ...(offerNow ? ["palm:offer"] : [])],
    stage: state.report.stage === "offered" ? "awaiting_payment" : "reading_given",
  });
}

export const palmReadingSpecialist: Specialist<"palm_reading"> = {
  kind: "palm_reading",
  run(ctx) {
    return ctx.config.paid_report_enabled ? runPaidFlow(ctx) : runFreeFlow(ctx);
  },
};
