import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import type { Usage } from "../types";
import { decompositionSchema, type Decomposition } from "./schemas";

export interface DecomposedQuestion {
  needsRetrieval: boolean;
  standaloneQuestion: string;
  requiresDecomposition: boolean;
  reasoning: string;
  subQuestions: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Apply the limits and fallbacks the schema cannot express. */
export function normaliseDecomposition(
  data: Decomposition,
  latest: string,
  maxQuestions: number,
): DecomposedQuestion {
  const standalone = data.standalone_question.trim() || latest;
  const subs = data.requires_decomposition
    ? unique(data.sub_questions.map((q) => q.question.trim())).slice(0, maxQuestions)
    : [];
  return {
    needsRetrieval: data.needs_retrieval,
    standaloneQuestion: standalone,
    requiresDecomposition: subs.length > 1,
    reasoning: data.reasoning,
    subQuestions: subs.length ? subs : [standalone],
  };
}

const PROMPT = (maxQuestions: number) => `You are a query decomposition specialist inside a WhatsApp customer assistant.
You analyse the customer's latest message and decide what must be looked up in the business's knowledge base (FAQ, policies, product and pricing notes) to answer it.

You do NOT answer the customer and you do NOT look anything up.

STEP 1 — needs_retrieval
Set needs_retrieval=false for greetings, thanks, acknowledgements, small talk, or messages that need no business facts. Otherwise true.

STEP 2 — standalone_question
Rewrite the latest request as one self-contained question. Resolve references ("it", "that one", "the second plan") from the conversation. Keep product names, places, dates and quantities exactly.

STEP 3 — decomposition
If the request needs ONE fact or one policy, set requires_decomposition=false and return one sub-question.
If it combines several topics, products, comparisons or conditions, set requires_decomposition=true and break it into atomic sub-questions.

RULES
1. Each sub-question covers ONE clear topic.
2. Together they cover the whole request.
3. No duplicates, nothing unrelated to the request.
4. Each is understandable without reading the others.
5. Do not answer, do not invent facts.
6. At most ${maxQuestions} sub-questions.
7. Useful dimensions (only when relevant): product/service details, price and fees, availability and stock, delivery and shipping, returns/refunds/cancellation, warranty, eligibility, how-to/process, hours, location, contact.

EXAMPLE
Customer: "Do you deliver to Pune and how many days do I get to return shoes?"
Good:
1. Does the business deliver to Pune?
2. What is the return window for shoes?
Bad:
1. What is delivery?
2. Are shoes good?`;

export async function decomposeQuestion(
  llm: LlmToolkit,
  spec: ModelSpec,
  args: { conversation: string; latest: string; maxQuestions: number },
  config?: RunnableConfig,
): Promise<{ result: DecomposedQuestion; usage: Usage }> {
  const { data, usage } = await llm.structured(
    spec,
    decompositionSchema,
    "decompose_question",
    [
      new SystemMessage(PROMPT(args.maxQuestions)),
      new HumanMessage(
        `CONVERSATION (oldest first):\n${args.conversation || "(none)"}\n\nLATEST CUSTOMER MESSAGE:\n${args.latest}`,
      ),
    ],
    config,
  );
  return { result: normaliseDecomposition(data, args.latest, args.maxQuestions), usage };
}
