import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface TagSuggestionTag {
  id: string;
  name: string;
}

let _client: OpenAI | null = null;

export function openaiClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return _client;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Customer-sent images from WhatsApp, as base64 data URLs for vision. */
  imageDataUrls?: string[];
}

const SYSTEM_PROMPT = `You are a helpful WhatsApp customer-support agent. 
Based on the conversation history, generate exactly 3 short, natural reply suggestions the agent could send next.
Rules:
- Each suggestion must be concise (1-2 sentences max)
- Match the language and tone already used in the conversation
- Suggestions should be genuinely helpful and move the conversation forward
- Do NOT number them or add bullet points
- Separate the 3 suggestions with the delimiter: |||
- Output ONLY the 3 suggestions separated by |||, nothing else`;

export async function generateReplySuggestions(
  messages: ChatMessage[],
  contactName: string,
): Promise<string[]> {
  const client = openaiClient();

  const userMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const contextNote =
    contactName
      ? `\n\n[Context: You are replying to a customer named ${contactName}]`
      : "";

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT + contextNote },
      ...userMessages,
      {
        role: "user",
        content:
          "[Generate 3 reply suggestions for the agent to send next, separated by |||]",
      },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const suggestions = raw
    .split("|||")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (suggestions.length === 0) {
    throw new Error("OpenAI returned no suggestions");
  }

  return suggestions;
}

const TAG_SYSTEM_PROMPT = `You are a CRM assistant analyzing WhatsApp conversations.
Given a conversation history and a list of available tags, return the IDs of tags that best describe the contact or their intent.
Rules:
- Only select tags from the provided list. Do NOT invent new tag IDs.
- Return a JSON array of tag ID strings, nothing else. Example: ["id1","id2"]
- Return an empty array [] if no tags are relevant.
- Select at most 5 tags.`;

export async function suggestTags(
  messages: ChatMessage[],
  contactName: string,
  availableTags: TagSuggestionTag[],
): Promise<string[]> {
  if (availableTags.length === 0) return [];

  const client = openaiClient();

  const tagList = availableTags
    .map((t) => `{ "id": "${t.id}", "name": "${t.name}" }`)
    .join("\n");

  const contextNote = contactName
    ? `\n\n[Contact name: ${contactName}]`
    : "";

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          TAG_SYSTEM_PROMPT +
          contextNote +
          `\n\nAvailable tags:\n${tagList}`,
      },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content:
          "[Return a JSON array of tag IDs from the available tags list that best fit this conversation. Return only the JSON array.]",
      },
    ],
    max_tokens: 200,
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(availableTags.map((t) => t.id));
    return parsed.filter((id): id is string => typeof id === "string" && validIds.has(id));
  } catch {
    return [];
  }
}

const LEAD_SCORE_SYSTEM_PROMPT = `You are a CRM analyst evaluating the sales/support potential of a WhatsApp contact based on their conversation history.
Score the lead from 0 to 100 where:
- 80–100: Highly engaged, clear buying intent, responsive, positive sentiment
- 60–79: Interested, asks follow-up questions, reasonably responsive
- 40–59: Somewhat engaged, mixed signals or slow to respond
- 20–39: Low engagement, mostly passive or one-sided
- 0–19: Unresponsive, uninterested, or complaint/churn risk

Rules:
- Consider: message frequency, response speed, sentiment, specificity of questions, purchase signals
- Output ONLY valid JSON with exactly two fields: { "score": <integer 0-100>, "reasoning": "<1-2 sentences explaining the score>" }
- Do NOT include markdown, code fences, or any other text`;

export interface LeadScoreResult {
  score: number;
  reasoning: string;
}

export async function scoreContact(
  messages: ChatMessage[],
  contactName: string,
): Promise<LeadScoreResult> {
  const client = openaiClient();

  const contextNote = contactName
    ? `\n\n[Contact name: ${contactName}]`
    : "";

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: LEAD_SCORE_SYSTEM_PROMPT + contextNote },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: "[Score this lead. Output only the JSON object.]",
      },
    ],
    max_tokens: 150,
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";

  try {
    const parsed = JSON.parse(raw) as { score?: unknown; reasoning?: unknown };
    const score = typeof parsed.score === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 50;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    return { score, reasoning };
  } catch {
    return { score: 50, reasoning: "Unable to parse AI response." };
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are a CRM assistant summarizing a WhatsApp customer conversation for a support agent.
Write a concise 3-5 sentence plain-English summary covering:
1. What the customer asked for or the problem they reported
2. What the support team has done so far
3. The current status and the clearest next step (if any)
Rules:
- Be factual and specific — use details from the conversation
- Write in third person (e.g. "The customer asked…", "The agent confirmed…")
- Do NOT use bullet points, headers, or markdown — plain prose only
- Output ONLY the summary, nothing else`;

export async function summarizeConversation(
  messages: ChatMessage[],
  contactName: string,
): Promise<string> {
  const client = openaiClient();

  const contextNote = contactName
    ? `\n\n[Contact name: ${contactName}]`
    : "";

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT + contextNote },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: "[Summarize this conversation in 3-5 sentences as described.]",
      },
    ],
    max_tokens: 250,
    temperature: 0.3,
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

const WHATSAPP_REPLY_RULES = `
Rules for your reply:
- Write ONE complete WhatsApp message — sound like a real person texting, not a chatbot
- Never mention AI, language models, or that you are automated
- Use natural, warm language — contractions, occasional gentle emoji (sparingly), varied sentence length
- Match the language the customer uses
- Do not use markdown headers or numbered lists unless very short
- When the customer sent a photo, look at it carefully and reference specific details you can see before interpreting
- Output ONLY the message text to send, nothing else`;

function toOpenAiMessage(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "assistant" || !m.imageDataUrls?.length) {
    return { role: m.role, content: m.content };
  }

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: m.content.trim() || "[Customer sent a photo]",
    },
  ];
  for (const url of m.imageDataUrls) {
    parts.push({
      type: "image_url",
      image_url: { url, detail: "high" },
    });
  }
  return { role: "user", content: parts };
}

export interface AiAgentPromptConfig {
  system_prompt: string;
  model: string;
  temperature: number;
}

export async function generateAgentReply(
  messages: ChatMessage[],
  agent: AiAgentPromptConfig,
  contactName: string,
): Promise<string> {
  const client = openaiClient();

  const hasImages = messages.some((m) => (m.imageDataUrls?.length ?? 0) > 0);
  const contextNote = contactName
    ? `\n\n[Context: You are replying to a customer named ${contactName}]`
    : "";
  const visionNote = hasImages
    ? `\n\n[The customer included photo(s) in this conversation. Study the image(s) closely — describe what you actually see (lines, shapes, lighting, hand position) before giving your reading.]`
    : "";

  const model = hasImages ? "gpt-4o" : (agent.model || "gpt-4o");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: agent.system_prompt + contextNote + visionNote + WHATSAPP_REPLY_RULES,
      },
      ...messages.map(toOpenAiMessage),
    ],
    max_tokens: hasImages ? 900 : 600,
    temperature: agent.temperature ?? 0.8,
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!reply) {
    throw new Error("OpenAI returned an empty reply");
  }
  return reply;
}
