/** WhatsApp caps text at 4096 chars; conversational replies should be far shorter. */
export const MAX_REPLY_CHARS = 1600;

const AI_DISCLOSURE =
  /\b(as an ai|an ai (language )?model|i am an ai|i'm an ai|language model|chatgpt|openai|my training data|knowledge cutoff|i am a bot|i'm a bot)\b/i;

const TEMPLATE_ARTIFACT = /\{\{|\}\}|\[(customer|insert|your name|name)\b[^\]]*\]/i;

export interface GuardResult {
  text: string;
  violations: string[];
}

function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "), slice.lastIndexOf("\n"));
  return (cut > max * 0.5 ? slice.slice(0, cut + 1) : slice).trim();
}

/** Deterministic cleanup to WhatsApp formatting. */
export function normaliseReply(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^(assistant|reply|message|response)\s*:\s*/i, "");
  if (/^"[\s\S]*"$/.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  text = text.replace(/__(.+?)__/g, "_$1_");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return truncateAtSentence(text, MAX_REPLY_CHARS);
}

export function checkReply(raw: string): GuardResult {
  const text = normaliseReply(raw);
  const violations: string[] = [];
  if (!text) violations.push("the reply was empty");
  if (AI_DISCLOSURE.test(text)) violations.push("it mentioned being an AI or a model");
  if (TEMPLATE_ARTIFACT.test(text)) violations.push("it contained template placeholders");
  return { text, violations };
}

/** Last resort: drop the offending sentences. Returns "" if nothing usable remains. */
export function stripViolations(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !AI_DISCLOSURE.test(sentence) && !TEMPLATE_ARTIFACT.test(sentence))
    .join(" ")
    .trim();
}
