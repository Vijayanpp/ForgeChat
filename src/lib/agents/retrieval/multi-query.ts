import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import type { Usage } from "../types";
import { multiQuerySchema, type MultiQuery } from "./schemas";

/**
 * The question itself is always searched first, then the generated
 * variations; near-duplicates are dropped.
 */
export function normaliseQueries(question: string, data: MultiQuery | null, maxQueries: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [question, ...(data?.queries.map((x) => x.query) ?? [])]) {
    const key = q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q.trim());
    if (out.length >= maxQueries + 1) break;
  }
  return out;
}

const PROMPT = (maxQueries: number) => `You are a search query generation specialist inside a WhatsApp customer assistant.
Convert ONE question into several search queries that will be run against the business's own knowledge base (FAQ, policies, product and pricing notes) using keyword search.

The goal is RECALL: the knowledge base may describe the same thing with different words than the customer used.

RULES
1. Generate between 2 and ${maxQueries} queries.
2. Every query stays relevant to the question.
3. Queries represent meaningfully different angles, not one-word variations.
4. Use words likely to appear in a business FAQ or policy page (e.g. customer says "send back" → "return policy", "refund"; "how much" → "price", "fee", "cost").
5. Keep queries short (2-8 words), no explanations.
6. Preserve product names, places, dates and quantities.
7. Do not answer the question, do not invent products, prices or facts.
8. Useful angles (only when relevant): policy terminology, product terminology, pricing terminology, process/how-to terminology, synonyms and customer phrasing.

EXAMPLE
Question: How many days do I have to send back shoes?
Good:
1. return policy footwear — policy terminology
2. refund exchange window days — synonym terminology
3. how to return an order — process terminology
Bad:
return shoes / return shoes days / shoes return
(superficial variations of the same search)`;

export async function generateSearchQueries(
  llm: LlmToolkit,
  spec: ModelSpec,
  args: { question: string; maxQueries: number },
  config?: RunnableConfig,
): Promise<{ queries: string[]; usage: Usage }> {
  const { data, usage } = await llm.structured(
    spec,
    multiQuerySchema,
    "generate_search_queries",
    [new SystemMessage(PROMPT(args.maxQueries)), new HumanMessage(`QUESTION:\n${args.question}`)],
    config,
  );
  return { queries: normaliseQueries(args.question, data, args.maxQueries), usage };
}
