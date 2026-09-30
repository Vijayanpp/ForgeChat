import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import type { ImageAnalysis } from "../payments/receipt";
import { customer, emptySession, fakeLlm, systemText, testAgent, testRuntime, testServices } from "../testing/fakes";
import type { ChatTurn, SessionState } from "../types";
import { parseAgentConfig } from "./catalog";
import type { ReportRequest, SpecialistServices } from "./contract";
import {
  initialFreeTurns,
  palmReadingSpecialist,
  payeeAliases,
  planPalmTurn,
  offerScript,
  withPaymentOffer,
} from "./palm-reading";
import { attachPaymentOffer } from "./palm-offer";

describe("planPalmTurn", () => {
  it("asks for a photo first, reads it, then offers after the free readings", () => {
    expect(planPalmTurn({ hasNewPhoto: false, readingsGiven: 0, offerMade: false, upsellAfterReadings: 1 })).toEqual({
      mode: "request_photo",
      offerNow: false,
      readingsAfter: 0,
    });
    expect(planPalmTurn({ hasNewPhoto: true, readingsGiven: 0, offerMade: false, upsellAfterReadings: 1 })).toMatchObject({
      mode: "reading",
      offerNow: false,
      readingsAfter: 1,
    });
    expect(planPalmTurn({ hasNewPhoto: false, readingsGiven: 1, offerMade: false, upsellAfterReadings: 1 })).toMatchObject({
      mode: "follow_up",
      offerNow: true,
    });
    expect(planPalmTurn({ hasNewPhoto: false, readingsGiven: 3, offerMade: true, upsellAfterReadings: 1 }).offerNow).toBe(false);
  });
});

describe("initialFreeTurns", () => {
  it("uses stored free_turns when present", () => {
    expect(
      initialFreeTurns({
        slots: { free_turns: 2, readings_given: 1 },
        readingsGiven: 1,
        transcript: [customer("q1"), customer("q2"), customer("q3")],
      }),
    ).toBe(2);
  });

  it("backfills older chats from photos or prior questions, not only photos", () => {
    expect(
      initialFreeTurns({
        slots: { readings_given: 1 },
        readingsGiven: 1,
        transcript: [customer("hi"), customer("and my career?"), customer("marriage?"), customer("health?")],
      }),
    ).toBe(3);
  });
});

const parsed = parseAgentConfig("palm_reading", {
  business_name: "AskMyPalm",
  paid_report_enabled: true,
  upsell_after_readings: 5,
  payment_link: "razorpay.me/@askmypalm",
});
if (!parsed.ok) throw new Error(parsed.error);
const config = parsed.config;

const NOW = new Date("2026-09-30T10:00:00Z");
const photo = (id: string): ChatTurn =>
  customer("", "2026-09-30T09:59:00Z", { imageDataUrls: ["data:image/jpeg;base64,AAAA"], mediaUrl: `wa:${id}`, messageId: id });

const goodReceipt: ImageAnalysis = {
  image_type: "payment_receipt",
  payment_status: "success",
  amount: 499,
  currency: "INR",
  payee_name: "AskMyPalm",
  payee_handle: "",
  razorpay_payment_id: "",
  utr: "612345678901",
  paid_at: "2026-09-30T15:20",
  app: "Google Pay",
  edit_suspicion: "none",
  notes: "",
};

interface Scripted {
  image?: Partial<ImageAnalysis>;
  details?: Record<string, string>;
  services?: Partial<SpecialistServices>;
}

function run(transcript: ChatTurn[], session: SessionState, script: Scripted = {}) {
  const prompts: string[] = [];
  const llm = fakeLlm(
    {
      analyze_customer_image: () => ({
        ...goodReceipt,
        image_type: "palm",
        payment_status: "unknown",
        amount: 0,
        utr: "",
        razorpay_payment_id: "",
        ...script.image,
      }),
      report_details_extract: () => ({
        full_name: "",
        date_of_birth: "",
        birth_time: "",
        birth_place: "",
        email: "",
        confirmation: "none",
        ...script.details,
      }),
    },
    (messages: BaseMessage[]) => {
      prompts.push(systemText(messages));
      return "reply";
    },
  );
  const result = palmReadingSpecialist.run({
    agent: testAgent({ agent_type: "palm_reading" }),
    config,
    transcript,
    session,
    contactName: "Lavish",
    conversationKey: "conv-1",
    refs: { conversationId: "conv-1", contactId: "contact-1", userId: "user-1" },
    llm,
    runtime: testRuntime,
    services: testServices(script.services),
    now: NOW,
  });
  return { result, prompts, llm };
}

const slotsOf = (r: Awaited<ReturnType<typeof palmReadingSpecialist.run>>) => r.session!.slots as Record<string, unknown>;
const reportOf = (r: Awaited<ReturnType<typeof palmReadingSpecialist.run>>) =>
  slotsOf(r).report as Record<string, unknown>;

describe("palm paid report flow", () => {
  it("derives payee aliases from the payment link", () => {
    expect(config.payment_link).toBe("https://razorpay.me/@askmypalm");
    expect(payeeAliases(config)).toEqual(["askmypalm", "AskMyPalm"]);
  });

  it("offer script names the price and Razorpay link and forbids a website pitch", () => {
    const script = offerScript({ ...config, report_price_inr: 399 });
    expect(script).toContain("₹399");
    expect(script).toContain("https://razorpay.me/@askmypalm");
    expect(script).toContain("Never say \"visit our website\"");
    expect(script).toContain("[payment link](#)");
  });

  it("replaces placeholder markdown links with the real Razorpay URL", () => {
    const fake = "You can follow this [payment link](#) to proceed.";
    const out = withPaymentOffer(fake, { ...config, report_price_inr: 399 });
    expect(out).not.toContain("[payment link]");
    expect(out).not.toContain("(#)");
    expect(out).toContain("https://razorpay.me/@askmypalm");
    expect(out).toContain("₹399");
  });

  it("replaces a website pitch with the ₹399 Razorpay plan", () => {
    const website =
      "I'm glad you're interested. You can visit our Askmypalm website and purchase the report there.";
    const out = withPaymentOffer(website, { ...config, report_price_inr: 399 });
    expect(out.toLowerCase()).not.toMatch(/visit our|askmypalm website/);
    expect(out).toContain("₹399");
    expect(out).toContain("https://razorpay.me/@askmypalm");
    expect(out).toContain("payment screenshot");
  });

  it("does not duplicate the link when the model already pasted it", () => {
    const ok = "Pay ₹499 here:\nhttps://razorpay.me/@askmypalm";
    expect(withPaymentOffer(ok, config)).toBe(ok);
  });

  it("pins the Razorpay URL when the customer asks for the report, even with no palm photo yet", () => {
    const out = attachPaymentOffer("You can follow this [payment link](#) to proceed.", config, {
      customerText: "I want the detailed report",
    });
    expect(out).toContain("https://razorpay.me/@askmypalm");
    expect(out).not.toContain("[payment link]");
  });

  it("does not pin the plan after payment is received", () => {
    const thanks = "Thank you for the payment, Pp! Could you send a palm photo?";
    const out = attachPaymentOffer(thanks, config, {
      stage: "collecting_details",
      reportStage: "collecting",
      paymentStatus: "verified",
    });
    expect(out).not.toContain("razorpay.me");
  });

  it("does not pin the plan on ordinary chat just because paid reports are on", () => {
    const out = attachPaymentOffer("Here is your free reading.", config, { stage: "reading_given" });
    expect(out).not.toContain("razorpay.me");
  });

  it("accepts a payment screenshot before the free readings are finished", async () => {
    const r = await run([photo("pay-early")], emptySession(), { image: goodReceipt }).result;
    expect(r.steps).toEqual(["palm:image:payment_receipt", "palm:payment:verified"]);
    expect(reportOf(r)).toMatchObject({ stage: "collecting", paymentStatus: "verified" });
    expect(r.reply).not.toContain("razorpay.me");
  });

  it("gives free readings and offers the report with the last one", async () => {
    const { result, prompts, llm } = run([photo("m5")], emptySession({ slots: { readings_given: 4, palm_media: ["wa:m4"] } }));
    const r = await result;
    expect(r.steps).toEqual(["palm:image:palm", "palm:reading", "palm:offer"]);
    expect(llm.calls.some((c) => c.name === "analyze_customer_image")).toBe(true);
    expect(slotsOf(r)).toMatchObject({ readings_given: 5, free_turns: 5, palm_media: ["wa:m4", "wa:m5"] });
    expect(reportOf(r)).toMatchObject({ stage: "offered", offeredAt: NOW.toISOString() });
    expect(prompts[0]).toContain("free reading 5 of 5");
    expect(prompts[0]).toContain("https://razorpay.me/@askmypalm");
    expect(prompts[0]).toContain("₹499");
    expect(r.reply).toContain("https://razorpay.me/@askmypalm");
  });

  it("counts a first greeting as a free answer but does not offer yet", async () => {
    const { result, prompts } = run([customer("Hi Guruji")], emptySession());
    const r = await result;
    expect(r.steps).toEqual(["palm:request_photo"]);
    expect(slotsOf(r).free_turns).toBe(1);
    expect(reportOf(r).stage).toBe("none");
    expect(prompts[0]).not.toContain("Close the sale");
    expect(r.reply).not.toContain("razorpay.me");
  });

  it("does not offer on a mid-quota follow-up question", async () => {
    const r = await run(
      [customer("What about my career?")],
      emptySession({ slots: { readings_given: 1, free_turns: 3 } }),
    ).result;
    expect(r.steps).toEqual(["palm:follow_up"]);
    expect(slotsOf(r)).toMatchObject({ readings_given: 1, free_turns: 4 });
    expect(reportOf(r).stage).toBe("none");
    expect(r.reply).not.toContain("razorpay.me");
  });

  it("offers the paid report on the 5th question, not only the 5th palm photo", async () => {
    const { result, prompts } = run(
      [customer("And what about marriage?")],
      emptySession({ slots: { readings_given: 1, free_turns: 4 } }),
    );
    const r = await result;
    expect(r.steps).toEqual(["palm:follow_up", "palm:offer"]);
    expect(slotsOf(r)).toMatchObject({ readings_given: 1, free_turns: 5 });
    expect(reportOf(r)).toMatchObject({ stage: "offered", offeredAt: NOW.toISOString() });
    expect(prompts[0]).toContain("Close the sale");
    expect(prompts[0]).toContain("https://razorpay.me/@askmypalm");
    expect(r.reply).toContain("https://razorpay.me/@askmypalm");
  });

  it("offers immediately on older chats that already used the free questions", async () => {
    const transcript = [
      customer("hi"),
      customer("career?"),
      customer("money?"),
      customer("health?"),
      customer("and marriage?"),
    ];
    const r = await run(transcript, emptySession({ slots: { readings_given: 1 } })).result;
    expect(r.steps).toContain("palm:offer");
    expect(slotsOf(r).free_turns).toBeGreaterThanOrEqual(5);
    expect(reportOf(r).stage).toBe("offered");
    expect(r.reply).toContain("https://razorpay.me/@askmypalm");
  });

  it("does not read more palms once the free readings are used", async () => {
    const session = emptySession({ slots: { readings_given: 5, report: { stage: "offered" } } });
    const { result, prompts } = run([photo("m6")], session, { image: { image_type: "palm" } });
    const r = await result;
    expect(r.steps).toEqual(["palm:image:palm"]);
    expect(slotsOf(r).readings_given).toBe(5);
    expect(prompts[0]).toContain("Do not give a new reading");
  });

  it("verifies a payment screenshot and asks for birth details", async () => {
    const session = emptySession({ slots: { readings_given: 5, report: { stage: "offered", offeredAt: "2026-09-30T09:00:00Z" } } });
    const { result, prompts } = run([photo("m7")], session, { image: goodReceipt });
    const r = await result;
    expect(r.steps).toEqual(["palm:image:payment_receipt", "palm:payment:verified"]);
    expect(reportOf(r)).toMatchObject({ stage: "collecting", paymentId: "TEST-PAYMENT", paymentStatus: "verified" });
    expect(prompts[0]).toContain("Payment is confirmed");
    expect(prompts[0]).toContain("date of birth");
  });

  it("hands off after three rejected screenshots", async () => {
    const session = emptySession({ slots: { readings_given: 5, report: { stage: "offered", rejections: 2 } } });
    const r = await run([photo("m8")], session, { image: { ...goodReceipt, amount: 49 } }).result;
    expect(r.handoff).toBe(true);
    expect(r.reply).toBeNull();
    expect(reportOf(r)).toMatchObject({ rejections: 3 });
  });

  const collecting = (paymentStatus: string, extra: Record<string, unknown> = {}) =>
    emptySession({
      slots: {
        readings_given: 5,
        palm_media: ["wa:m1"],
        report: { stage: "collecting", paymentId: "pay-row-1", paymentStatus, ...extra },
      },
    });
  const allDetails = {
    full_name: "Lavish Malik",
    date_of_birth: "2010-12-17",
    birth_time: "13:56",
    birth_place: "Ganaur, Sonipat, Haryana",
    email: "Lavish@gmail.com",
  };

  it("confirms details, then queues the report exactly on YES", async () => {
    const requests: ReportRequest[] = [];
    const services: Partial<SpecialistServices> = {
      reports: {
        ...testServices().reports,
        async requestReport(req) {
          requests.push(req);
          return { reportId: "report-9", created: true };
        },
      },
    };

    const first = await run([customer("Lavish Malik, 17/12/2010, 1:56 pm, Ganaur Sonipat Haryana, Lavish@gmail.com")], collecting("verified"), {
      details: allDetails,
      services,
    }).result;
    expect(first.steps).toContain("palm:details:confirm");
    expect(first.reply).toContain("*Name:* Lavish Malik");
    expect(first.reply).toContain("Reply *YES*");
    expect(requests).toHaveLength(0);

    const second = await run([customer("yes")], first.session as SessionState, {
      details: { ...allDetails, confirmation: "yes" },
      services,
    }).result;
    expect(second.steps).toContain("palm:report_requested");
    expect(reportOf(second)).toMatchObject({ stage: "queued", reportId: "report-9" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      paymentId: "pay-row-1",
      palmMediaUrls: ["wa:m1"],
      subject: { fullName: "Lavish Malik", birthTime: "13:56", email: "lavish@gmail.com", timezone: "Asia/Kolkata" },
    });
  });

  it("re-confirms when a detail changes instead of booking", async () => {
    const session = collecting("verified", { stage: "confirming", details: allDetails, place: { displayName: "Ganaur", latitude: 29, longitude: 77, timezone: "Asia/Kolkata" } });
    session.slots = { ...session.slots, report: { ...(session.slots.report as object), details: { ...allDetails, email: "lavish@gmail.com" } } };
    const r = await run([customer("yes but email is new@gmail.com")], session, {
      details: { email: "new@gmail.com", confirmation: "yes" },
    }).result;
    expect(r.steps).toContain("palm:details:confirm");
    expect(r.reply).toContain("new@gmail.com");
  });

  it("waits for human verification before queuing the report", async () => {
    const session = collecting("pending_review", {
      stage: "confirming",
      details: { ...allDetails, email: "lavish@gmail.com" },
      place: { displayName: "Ganaur", latitude: 29, longitude: 77, timezone: "Asia/Kolkata" },
    });
    const r = await run([customer("yes")], session, { details: { confirmation: "yes" } }).result;
    expect(r.steps).toContain("palm:details:wait_payment");
    expect(reportOf(r).stage).toBe("waiting_payment");
  });

  it("asks again for invalid or unknown details", async () => {
    const r = await run([customer("my email is lavish@gmail")], collecting("verified"), {
      details: { full_name: "Lavish Malik", email: "lavish@gmail", birth_place: "Atlantis" },
      services: { reports: { ...testServices().reports, resolvePlace: async () => null } },
    });
    const out = await r.result;
    expect(out.steps).toEqual(["palm:details_extract", "palm:place_unknown", "palm:details:ask_missing"]);
    expect(r.prompts[0]).toContain("email address for the report");
    expect(r.prompts[0]).toContain("couldn't be found");
    expect(reportOf(out).details).toEqual({ full_name: "Lavish Malik" });
  });
});
