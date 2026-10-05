import { parseAgentConfig, type PalmReadingConfig } from "./catalog";

export function planLink(config: PalmReadingConfig): string {
  return (config.payment_link || config.offer_link).trim();
}

export function planPrice(config: PalmReadingConfig): string {
  return config.paid_report_enabled
    ? `₹${config.report_price_inr}`
    : config.offer_price.trim() || `₹${config.report_price_inr}`;
}

export function planName(config: PalmReadingConfig): string {
  return config.offer_name || "5 more palm readings";
}

export function packSize(config: PalmReadingConfig): number {
  return Math.max(1, config.pack_size);
}

/** The block we pin onto WhatsApp messages. Never markdown. */
export function planBlock(config: PalmReadingConfig): string {
  const link = planLink(config);
  const price = planPrice(config);
  const name = planName(config);
  if (!link) return `*${name} — ${price}*\nPay, then send the payment screenshot in this chat.`;
  return `*${name} — ${price}*\n${link}\n\nPay this amount, then send the payment screenshot here.`;
}

export function offerScript(config: PalmReadingConfig): string {
  const price = planPrice(config);
  const link = planLink(config);
  const readings = packSize(config);
  const pay = link
    ? `Write this exact URL as plain text on its own line (never as markdown): ${link}`
    : "The payment link is missing from agent settings — do not invent a website or another URL.";
  return `SELL THIS PLAN (copy these facts; do not invent others): ${planName(config)} — ${readings} more palm readings for ${price}. ${pay}. After they pay, they must send the payment screenshot in this same chat.
Hard rules:
- This reply MUST include the price ${price}, that they get ${readings} more readings${link ? `, and the raw URL ${link}` : ""}.
- Never write markdown links such as [payment link](#) or [payment link](url). WhatsApp will not open them.
- Never say "visit our website", "Askmypalm website", "reach out to our team", "contact us", or "learn more about the process". There is no website checkout — payment is only via the Razorpay link in this chat.
- Never invent a different price, plan, or URL.
- Do not mention an emailed report, a Vedic chart, or birth details.
- Two or three warm Guruji sentences, then the price, then the raw URL, then "send the payment screenshot here".`;
}

export function paymentFactsForPrompt(config: PalmReadingConfig): string {
  const link = planLink(config);
  const price = planPrice(config);
  return `\n\n[Paid plan facts — use ONLY when this turn is actually selling more readings. If they still have paid readings left, or you are giving a free reading, do not mention the price or payment link.]\nName: ${planName(config)}\nPrice: ${price} for ${packSize(config)} more readings${
    link ? `\nPay here: ${link}` : ""
  }\nAfter paying they send the payment screenshot in this chat. Never send them to a website.`;
}

const WEBSITE_PITCH =
  /(?:you can |please )?(?:visit|see|check out|go to|head to)\s+(?:our\s+)?(?:the\s+)?(?:askmypalm\s+)?(?:web)?site\b[^.!?\n]*/gi;

export function stripWebsitePitch(reply: string): string {
  return reply
    .replace(/\[[^\]]+\]\([^)]*\)/g, "")
    .replace(WEBSITE_PITCH, "")
    .replace(/\bpurchase the report there\b/gi, "")
    .replace(/\breach out to our team\b/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Models invent "visit our website" or [payment link](#).
 * Strip that and pin the live plan (price + Razorpay URL) when we have one.
 */
export function withPaymentOffer(reply: string, config: PalmReadingConfig): string {
  const link = planLink(config);
  let text = stripWebsitePitch(reply);
  const block = planBlock(config);
  if (link && text.includes(link)) return text;
  if (!text) return block;
  return `${text}\n\n${block}`;
}

const SELL_TALK =
  /report|payment|\bpay\b|razorpay|\bplan\b|₹|rs\.?\s*\d|screenshot|purchase|\bbuy\b|price|50|399|499|\blink\b|website/i;

export function wantsPaidPlan(text: string): boolean {
  return SELL_TALK.test(text) || /\]\(\s*#?\s*\)/.test(text);
}

const SKIP_PLAN = new Set([
  "collecting_details",
  "confirming_details",
  "waiting_payment",
  "report_queued",
  "payment_issue",
]);

const PAID_REPORT_STAGES = new Set(["collecting", "confirming", "waiting_payment", "queued"]);

/** Pin the live URL only while we are still selling — never after payment, never on every chat. */
export function attachPaymentOffer(
  reply: string | null,
  config: PalmReadingConfig,
  ctx: {
    stage?: string;
    customerText?: string;
    reportStage?: string;
    paymentStatus?: string | null;
    packCredits?: number;
  } = {},
): string | null {
  if (!reply) return reply;
  const stage = ctx.stage ?? "";
  const inReportFlow = PAID_REPORT_STAGES.has(ctx.reportStage ?? "") || SKIP_PLAN.has(stage);
  if (inReportFlow || (ctx.packCredits ?? 0) > 0) return stripWebsitePitch(reply);

  const selling =
    stage === "awaiting_payment" || stage === "offer_made" || wantsPaidPlan(ctx.customerText ?? "");
  return selling ? withPaymentOffer(reply, config) : stripWebsitePitch(reply);
}

export function palmPayFromAgent(agent: { agent_type?: string | null; config?: unknown }): PalmReadingConfig | null {
  if (agent.agent_type && agent.agent_type !== "palm_reading") return null;
  const parsed = parseAgentConfig("palm_reading", agent.config ?? {});
  return parsed.ok ? parsed.config : null;
}

export function withPalmPaymentPrompt(systemPrompt: string, agent: { agent_type?: string | null; config?: unknown }): string {
  const config = palmPayFromAgent(agent);
  return config ? systemPrompt + paymentFactsForPrompt(config) : systemPrompt;
}

export function withPalmPaymentReply(
  reply: string,
  agent: { agent_type?: string | null; config?: unknown },
  customerText = "",
): string {
  const config = palmPayFromAgent(agent);
  if (!config) return reply;
  return attachPaymentOffer(reply, config, { customerText }) ?? reply;
}
