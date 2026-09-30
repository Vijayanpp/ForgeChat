import { z } from "zod";

import { MAX_KNOWLEDGE_CHARS, MAX_PRODUCT_SUMMARY_CHARS } from "../knowledge/limits";
import type { AgentKind } from "../types";

// Client-safe: imported by the agent form. Must not import server-only
// modules (LangChain, Supabase admin, node:*).

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/, "Must be an https:// URL");

const optionalHttpsUrl = z.union([httpsUrl, z.literal("")]).optional().default("");

const fieldKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, digits and underscores");

const baseConfig = z.object({
  business_name: z.string().trim().max(120).optional().default(""),
  handoff_keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  handoff_message: z.string().trim().max(500).optional().default(""),
});

export const customerServiceConfigSchema = baseConfig.extend({
  knowledge_base: z.string().max(MAX_KNOWLEDGE_CHARS).optional().default(""),
  /** When the knowledge base doesn't cover a question, hand off instead of guessing. */
  handoff_when_unknown: z.boolean().optional().default(true),
});

export const palmReadingConfigSchema = baseConfig.extend({
  offer_name: z.string().trim().max(120).optional().default("Detailed personal reading"),
  offer_price: z.string().trim().max(60).optional().default(""),
  offer_link: optionalHttpsUrl,
  /** Free answers (palm photos + follow-up questions) before the paid offer. */
  upsell_after_readings: z.number().int().min(0).max(10).optional().default(1),
  /**
   * Paid report flow: payment screenshot → verification → birth details
   * → generated HTML report emailed to the customer.
   */
  paid_report_enabled: z.boolean().optional().default(false),
  report_price_inr: z.number().int().min(1).max(100_000).optional().default(499),
  payment_link: z.preprocess(
    (v) => (typeof v === "string" && v.trim() && !/^[a-z]+:\/\//i.test(v.trim()) ? `https://${v.trim()}` : v),
    optionalHttpsUrl,
  ),
  /** Names/handles that must appear as the payee on a receipt. */
  payee_names: z.array(z.string().trim().min(3).max(80)).max(10).optional().default([]),
  /** "Brand <reports@your-domain>"; falls back to REPORT_EMAIL_FROM. */
  report_email_from: z.string().trim().max(200).optional().default(""),
  report_reply_to: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  report_model: z.string().trim().max(60).optional().default("gpt-4o"),
}).superRefine((c, ctx) => {
  if (c.paid_report_enabled && !(c.payment_link || c.offer_link)) {
    ctx.addIssue({
      code: "custom",
      path: ["payment_link"],
      message: "Payment link is required when Paid detailed report is on",
    });
  }
});

export const bookingFieldSchema = z.object({
  key: fieldKey,
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "date", "number", "phone", "email"]).default("text"),
  required: z.boolean().default(true),
});

export const ticketBookingConfigSchema = baseConfig.extend({
  offering_description: z.string().max(10_000).optional().default(""),
  fields: z
    .array(bookingFieldSchema)
    .min(1)
    .max(12)
    .optional()
    .default([
      { key: "event", label: "Event or show", type: "text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "tickets", label: "Number of tickets", type: "number", required: true },
      { key: "name", label: "Full name", type: "text", required: true },
    ]),
  availability_webhook_url: optionalHttpsUrl,
  booking_webhook_url: optionalHttpsUrl,
  /** HMAC secret for signing webhook calls. Generated server-side. */
  webhook_secret: z.string().max(200).optional().default(""),
});

export const qualificationFieldSchema = z.object({
  key: fieldKey,
  label: z.string().trim().min(1).max(80),
});

export const salesConfigSchema = baseConfig.extend({
  product_summary: z.string().max(MAX_PRODUCT_SUMMARY_CHARS).optional().default(""),
  qualification_fields: z
    .array(qualificationFieldSchema)
    .min(1)
    .max(8)
    .optional()
    .default([
      { key: "need", label: "What they need" },
      { key: "budget", label: "Budget" },
      { key: "timeline", label: "Timeline" },
      { key: "decision_maker", label: "Decision maker" },
    ]),
  next_step_link: optionalHttpsUrl,
});

export type CustomerServiceConfig = z.output<typeof customerServiceConfigSchema>;
export type PalmReadingConfig = z.output<typeof palmReadingConfigSchema>;
export type TicketBookingConfig = z.output<typeof ticketBookingConfigSchema>;
export type SalesConfig = z.output<typeof salesConfigSchema>;
export type BookingField = z.output<typeof bookingFieldSchema>;
export type QualificationField = z.output<typeof qualificationFieldSchema>;

export interface AgentKindConfigMap {
  customer_service: CustomerServiceConfig;
  palm_reading: PalmReadingConfig;
  ticket_booking: TicketBookingConfig;
  sales: SalesConfig;
}

export const AGENT_CONFIG_SCHEMAS = {
  customer_service: customerServiceConfigSchema,
  palm_reading: palmReadingConfigSchema,
  ticket_booking: ticketBookingConfigSchema,
  sales: salesConfigSchema,
} as const satisfies Record<AgentKind, z.ZodType>;

export interface AgentKindInfo {
  kind: AgentKind;
  label: string;
  description: string;
  starter: {
    name: string;
    description: string;
    temperature: number;
    systemPrompt: string;
  };
}

export const AGENT_KIND_CATALOG: Record<AgentKind, AgentKindInfo> = {
  customer_service: {
    kind: "customer_service",
    label: "Customer service",
    description: "Answers from your knowledge base and hands off anything it can't answer.",
    starter: {
      name: "Customer Support Agent",
      description: "Answers FAQs from the knowledge base; escalates complaints.",
      temperature: 0.4,
      systemPrompt: `You are a friendly, efficient customer support specialist.
- Answer only with facts from the knowledge provided to you
- Be concise and solve the customer's problem in as few messages as possible
- Apologise sincerely when something went wrong, without over-apologising
- Ask one clarifying question when the request is ambiguous`,
    },
  },
  palm_reading: {
    kind: "palm_reading",
    label: "Palm reading",
    description: "Reads palm photos with vision, then introduces your paid reading.",
    starter: {
      name: "Palm Reader",
      description: "Gives a warm first reading from a palm photo, then offers a paid reading.",
      temperature: 0.85,
      systemPrompt: `You are an experienced, warm palm reader and spiritual guide.
- Ask for a clear photo of the customer's dominant palm if you don't have one
- When you get a photo, describe specific lines you can see (heart, head, life, fate) before interpreting
- Frame readings as guidance and possibilities, never guarantees; never give medical, legal or financial predictions
- Be personal, hopeful and grounded`,
    },
  },
  ticket_booking: {
    kind: "ticket_booking",
    label: "Ticket booking",
    description: "Collects booking details step by step, confirms, then books via your webhook.",
    starter: {
      name: "Booking Assistant",
      description: "Collects booking details, confirms them, and books tickets.",
      temperature: 0.3,
      systemPrompt: `You are a helpful booking assistant.
- Collect the details needed for a booking, one or two at a time
- Confirm details back to the customer clearly before booking
- Be precise with dates, times and quantities`,
    },
  },
  sales: {
    kind: "sales",
    label: "Sales",
    description: "Qualifies leads (need, budget, timeline) and moves them to a next step.",
    starter: {
      name: "Sales Agent",
      description: "Qualifies inbound leads and books a next step.",
      temperature: 0.7,
      systemPrompt: `You are a consultative sales specialist.
- Understand the customer's need before pitching
- Ask at most one or two discovery questions per message
- Handle objections with empathy and specifics, never pressure
- Always move toward a clear next step`,
    },
  },
};

export type ConfigParseResult<K extends AgentKind> =
  | { ok: true; config: AgentKindConfigMap[K] }
  | { ok: false; error: string };

export function parseAgentConfig<K extends AgentKind>(
  kind: K,
  raw: unknown,
): ConfigParseResult<K> {
  const schema = AGENT_CONFIG_SCHEMAS[kind];
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue?.message ?? "invalid config"}` };
  }
  return { ok: true, config: result.data as AgentKindConfigMap[K] };
}

export function defaultAgentConfig<K extends AgentKind>(kind: K): AgentKindConfigMap[K] {
  return AGENT_CONFIG_SCHEMAS[kind].parse({}) as AgentKindConfigMap[K];
}
