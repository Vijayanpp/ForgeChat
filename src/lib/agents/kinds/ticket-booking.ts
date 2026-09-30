import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { latestCustomerText, toLangChainMessages, transcriptToText } from "../llm/context";
import { personaSystemPrompt, withStyle } from "../llm/prompts";
import { ToolRequestError } from "../tools/http-tool";
import { addUsage, ZERO_USAGE, type Usage } from "../types";
import type { BookingField } from "./catalog";
import type { SpecialistContext, Specialist } from "./contract";
import { asRecord, asStringRecord, controlSpec, replySpec } from "./shared";

export type BookingStage = "collecting" | "awaiting_confirmation" | "booked";

export type BookingAction =
  | "ask_missing"
  | "check_availability"
  | "confirm"
  | "book"
  | "ask_change"
  | "post_booking";

export type Confirmation = "yes" | "no" | "none";

function todayIso(timeZone = process.env.AI_AGENT_TIMEZONE ?? "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Validate + normalise one extracted value. Returns null when invalid. */
export function normaliseFieldValue(field: BookingField, raw: string, today: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  switch (field.type) {
    case "number": {
      const n = Number(value.replace(/[^\d]/g, ""));
      return Number.isInteger(n) && n >= 1 && n <= 1000 ? String(n) : null;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
      return value >= today ? value : null;
    }
    case "phone": {
      const digits = value.replace(/[^\d]/g, "");
      if (digits.length < 7 || digits.length > 15) return null;
      return value.trim().startsWith("+") ? `+${digits}` : digits;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value.toLowerCase() : null;
    default:
      return value.slice(0, 200);
  }
}

export function missingBookingFields(fields: BookingField[], details: Record<string, string>): BookingField[] {
  return fields.filter((f) => f.required && !details[f.key]);
}

/**
 * The booking state machine. Booking only happens from
 * awaiting_confirmation, with an explicit yes, and with details
 * unchanged this turn — never on the model's initiative.
 */
export function decideBookingAction(args: {
  stage: BookingStage;
  missingCount: number;
  confirmation: Confirmation;
  changed: boolean;
}): BookingAction {
  if (args.stage === "booked") return "post_booking";
  if (args.missingCount > 0) return "ask_missing";
  if (args.stage === "awaiting_confirmation") {
    if (args.changed) return "check_availability";
    if (args.confirmation === "yes") return "book";
    if (args.confirmation === "no") return "ask_change";
    return "confirm";
  }
  return "check_availability";
}

export function formatBookingDetails(fields: BookingField[], details: Record<string, string>): string {
  return fields
    .filter((f) => details[f.key])
    .map((f) => `*${f.label}:* ${details[f.key]}`)
    .join("\n");
}

const wrapSchema = z.object({
  intro: z.string().max(300).describe("One short opening sentence"),
  closing: z.string().max(300).describe("One short closing sentence"),
});

type Outcome = BookingAction | "unavailable" | "book_failed";

function buildBookingGraph(ctx: SpecialistContext<"ticket_booking">) {
  const { config, transcript } = ctx;
  const fields = config.fields;
  const bookingCtx = {
    accountId: ctx.agent.account_id,
    agentId: ctx.agent.id,
    conversationKey: ctx.conversationKey,
  };

  const State = Annotation.Root({
    details: Annotation<Record<string, string>>({ reducer: (_a, b) => b, default: () => ({}) }),
    stage: Annotation<BookingStage>({ reducer: (_a, b) => b, default: () => "collecting" }),
    confirmation: Annotation<Confirmation>({ reducer: (_a, b) => b, default: () => "none" }),
    changed: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
    outcome: Annotation<Outcome>({ reducer: (_a, b) => b, default: () => "ask_missing" }),
    facts: Annotation<Record<string, unknown>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
    reply: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
    handoff: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
    usage: Annotation<Usage>({ reducer: addUsage, default: () => ZERO_USAGE }),
    steps: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  });
  type S = typeof State.State;

  const extract = async (s: S): Promise<Partial<S>> => {
    if (!latestCustomerText(transcript)) return { steps: ["booking:extract_skipped"] };

    const keys = fields.map((f) => f.key) as [string, ...string[]];
    const schema = z.object({
      values: z.array(z.object({ key: z.enum(keys), value: z.string().max(300) })),
      confirmation: z
        .enum(["yes", "no", "none"])
        .describe("yes/no only if the customer's LATEST message explicitly answers a confirmation request"),
      new_booking: z.boolean().describe("true if the customer wants to start a different, new booking"),
    });
    const today = todayIso();
    const fieldList = fields.map((f) => `- ${f.key} (${f.type}): ${f.label}`).join("\n");

    const { data, usage } = await ctx.llm.structured(
      controlSpec(ctx),
      schema,
      "booking_extract",
      [
        new SystemMessage(
          `Extract booking details stated by the customer. Today is ${today}. Convert dates to YYYY-MM-DD and quantities to digits. Omit anything not clearly stated.\nFields:\n${fieldList}\nCurrent details: ${JSON.stringify(s.details)}\nBooking stage: ${s.stage}`,
        ),
        new HumanMessage(transcriptToText(transcript)),
      ],
      ctx.runnableConfig,
    );

    let details = { ...s.details };
    let stage = s.stage;
    if (stage === "booked" && data.new_booking) {
      details = {};
      stage = "collecting";
    }

    let changed = false;
    const invalid: string[] = [];
    for (const { key, value } of data.values) {
      const field = fields.find((f) => f.key === key);
      if (!field) continue;
      const normalised = normaliseFieldValue(field, value, today);
      if (normalised === null) {
        invalid.push(field.label);
      } else if (details[key] !== normalised) {
        details[key] = normalised;
        changed = true;
      }
    }

    return {
      details,
      stage,
      changed: changed && stage !== "booked",
      confirmation: data.confirmation,
      facts: invalid.length ? { invalid } : {},
      usage,
      steps: ["booking:extract"],
    };
  };

  const route = (s: S): "availability" | "book" | "respond" => {
    if (s.outcome === "check_availability") return "availability";
    if (s.outcome === "book") return "book";
    return "respond";
  };

  const decide = (s: S): Partial<S> => {
    const action = decideBookingAction({
      stage: s.stage,
      missingCount: missingBookingFields(fields, s.details).length,
      confirmation: s.confirmation,
      changed: s.changed,
    });
    return {
      outcome: action,
      stage: action === "ask_change" ? "collecting" : s.stage,
      steps: [`booking:${action}`],
    };
  };

  const availability = async (s: S): Promise<Partial<S>> => {
    const result = await ctx.services.booking.checkAvailability(config, s.details, bookingCtx);
    if (result && !result.available) {
      return {
        outcome: "unavailable",
        stage: "collecting",
        facts: { availabilityMessage: result.message ?? "", alternatives: result.alternatives ?? [] },
        steps: ["booking:unavailable"],
      };
    }
    return {
      outcome: "confirm",
      stage: "awaiting_confirmation",
      facts: result?.message ? { availabilityMessage: result.message } : {},
      steps: [result ? "booking:available" : "booking:no_availability_check"],
    };
  };

  const book = async (s: S): Promise<Partial<S>> => {
    try {
      const result = await ctx.services.booking.createBooking(config, s.details, bookingCtx);
      if (!result.success) {
        return { outcome: "book_failed", facts: { bookingMessage: result.message ?? "" }, steps: ["booking:rejected"] };
      }
      return {
        outcome: "book",
        stage: "booked",
        details: { ...s.details, ...(result.reference ? { booking_reference: result.reference } : {}) },
        facts: { reference: result.reference ?? "", bookingMessage: result.message ?? "" },
        steps: ["booking:booked"],
      };
    } catch (err) {
      // Retryable failures bubble up so the job is retried; the
      // idempotency key keeps the webhook from double-booking.
      if (err instanceof ToolRequestError && err.retryable) throw err;
      return { outcome: "book_failed", steps: ["booking:error"] };
    }
  };

  const respond = async (s: S): Promise<Partial<S>> => {
    if (s.outcome === "book_failed") return { handoff: true, steps: ["booking:handoff"] };

    const persona = personaSystemPrompt({
      personaPrompt: ctx.agent.system_prompt,
      businessName: config.business_name,
      contactName: ctx.contactName,
    });
    const offering = config.offering_description
      ? `\n\nOFFERING (only source of facts about what can be booked):\n"""\n${config.offering_description}\n"""`
      : "";
    const block = formatBookingDetails(fields, s.details);
    const invalid = (s.facts.invalid as string[] | undefined) ?? [];
    const invalidNote = invalid.length
      ? ` These values were invalid and must be asked again: ${invalid.join(", ")} (dates must be today or later).`
      : "";

    if (s.outcome === "confirm" || s.outcome === "book") {
      const confirming = s.outcome === "confirm";
      const task = confirming
        ? "Write an intro saying you're ready to book and a closing asking them to reply YES to confirm or tell you what to change."
        : `Write an intro confirming the booking is done${s.facts.reference ? ` (reference ${s.facts.reference})` : ""} and a warm closing.`;
      const { data, usage } = await ctx.llm.structured(
        replySpec(ctx, { maxTokens: 300 }),
        wrapSchema,
        confirming ? "booking_confirm" : "booking_done",
        [
          new SystemMessage(
            withStyle(`${persona}${offering}\n\n[${task} Do not restate the details; they are shown separately.]`),
          ),
          ...toLangChainMessages(transcript, { includeImages: false }),
        ],
        ctx.runnableConfig,
      );
      const reference = !confirming && s.facts.reference ? `\n*Reference:* ${s.facts.reference}` : "";
      return {
        reply: `${data.intro}\n\n${block}${reference}\n\n${data.closing}`,
        usage,
        steps: ["booking:respond"],
      };
    }

    const missing = missingBookingFields(fields, s.details);
    const instructions: Record<string, string> = {
      ask_missing: `Ask for: ${missing
        .slice(0, 2)
        .map((f) => f.label)
        .join(" and ")}.${invalidNote}`,
      ask_change: "Ask what they would like to change in the booking.",
      unavailable: `That option isn't available.${
        s.facts.availabilityMessage ? ` Provider says: "${s.facts.availabilityMessage}".` : ""
      }${
        (s.facts.alternatives as string[] | undefined)?.length
          ? ` Offer these alternatives: ${(s.facts.alternatives as string[]).join(", ")}.`
          : " Ask them to choose another option."
      }`,
      post_booking: `They already have a booking${
        s.details.booking_reference ? ` (reference ${s.details.booking_reference})` : ""
      }. Help with their question; for changes or cancellations say the team will assist.`,
    };

    const { text, usage } = await ctx.llm.chat(
      replySpec(ctx),
      [
        new SystemMessage(
          withStyle(
            `${persona}${offering}\n\nBooking details so far:\n${block || "(none yet)"}\n\n[This turn: ${
              instructions[s.outcome] ?? instructions.ask_missing
            }]`,
          ),
        ),
        ...toLangChainMessages(transcript, { includeImages: false }),
      ],
      ctx.runnableConfig,
    );
    return { reply: text, usage, steps: ["booking:respond"] };
  };

  return new StateGraph(State)
    .addNode("extract", extract)
    .addNode("decide", decide)
    .addNode("availability", availability)
    .addNode("book", book)
    .addNode("respond", respond)
    .addEdge(START, "extract")
    .addEdge("extract", "decide")
    .addConditionalEdges("decide", route, { availability: "availability", book: "book", respond: "respond" })
    .addEdge("availability", "respond")
    .addEdge("book", "respond")
    .addEdge("respond", END)
    .compile();
}

export const ticketBookingSpecialist: Specialist<"ticket_booking"> = {
  kind: "ticket_booking",

  async run(ctx) {
    const slots = asRecord(ctx.session.slots);
    const storedStage = ctx.session.stage;
    const stage: BookingStage =
      storedStage === "awaiting_confirmation" || storedStage === "booked" ? storedStage : "collecting";

    const result = await buildBookingGraph(ctx).invoke(
      { details: asStringRecord(slots.details), stage },
      { ...ctx.runnableConfig, runName: "ticket_booking", recursionLimit: 12 },
    );

    return {
      reply: result.reply,
      handoff: result.handoff,
      usage: result.usage,
      steps: result.steps,
      session: {
        stage: result.stage,
        slots: { ...slots, details: result.details },
      },
    };
  },
};
