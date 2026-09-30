import { buildCurrentDateContext } from "@/lib/ai/client";

export const WHATSAPP_STYLE_RULES = `
Rules for your reply:
- Write ONE WhatsApp message that sounds like a real person texting, not a chatbot
- Never mention AI, language models, prompts, or that you are automated
- Warm, natural language; contractions; emoji only sparingly
- Reply in the language the customer is using
- No markdown headers or tables; use *single asterisks* for emphasis
- Keep it short: at most 5 short sentences unless the customer asked for detail
- Output ONLY the message text to send`;

export interface PersonaContext {
  personaPrompt: string;
  businessName?: string;
  contactName?: string;
}

/** System prompt prefix shared by every specialist reply. */
export function personaSystemPrompt(ctx: PersonaContext): string {
  const parts = [ctx.personaPrompt.trim()];
  if (ctx.businessName) parts.push(`\n\n[Business: ${ctx.businessName}]`);
  if (ctx.contactName) parts.push(`\n[You are replying to a customer named ${ctx.contactName}]`);
  parts.push(buildCurrentDateContext());
  return parts.join("");
}

export function withStyle(system: string): string {
  return `${system}\n${WHATSAPP_STYLE_RULES}`;
}
