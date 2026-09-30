import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import type { Usage } from "../types";
import type { RetrievedChunk } from "./dedupe";
import { rerankSchema, type Reranking } from "./schemas";

const MAX_CONTENT_CHARS = 1200;

/**
 * Reattach ranked ids to the original chunks: unknown ids are dropped,
 * scores clamped to [0,1], weak evidence filtered, best first.
 */
export function applyReranking(
  documents: RetrievedChunk[],
  data: Reranking,
  opts: { topK: number; minRelevance: number },
): RetrievedChunk[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const ranked: RetrievedChunk[] = [];
  for (const r of data.ranked_documents) {
    const original = byId.get(r.document_id);
    if (!original || seen.has(r.document_id)) continue;
    seen.add(r.document_id);
    const relevance = Math.min(1, Math.max(0, Number.isFinite(r.relevance_score) ? r.relevance_score : 0));
    if (relevance < opts.minRelevance) continue;
    ranked.push({ ...original, relevance, rerankReason: r.reasoning });
  }
  return ranked.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, opts.topK);
}

const PROMPT = (topK: number) => `You are a retrieval reranking specialist inside a WhatsApp customer assistant.
Rank knowledge-base passages by how useful they are for answering the question.

CRITERIA
1. Direct relevance to the question.
2. Contains information that actually helps answer it (a fact, price, policy, step).
3. Specificity.
4. Adds information beyond the other passages.

SCORING (0 to 1)
0.90-1.00 answers the question directly
0.75-0.89 highly relevant
0.50-0.74 partly relevant
0.25-0.49 weak
0.00-0.24 irrelevant

RULES
1. Judge only the supplied content; do not invent facts.
2. Every document_id MUST be one of the supplied IDs.
3. Do not rank a passage highly just because it shares keywords; read it.
4. Return at most ${topK} passages, best first, each with one short reason.`;

export async function rerankChunks(
  llm: LlmToolkit,
  spec: ModelSpec,
  args: { question: string; documents: RetrievedChunk[]; topK: number; minRelevance: number },
  config?: RunnableConfig,
): Promise<{ documents: RetrievedChunk[]; usage: Usage }> {
  const topK = Math.min(args.topK, args.documents.length);
  const context = args.documents
    .map((d) => `DOCUMENT ID: ${d.id}\nCONTENT:\n${d.content.slice(0, MAX_CONTENT_CHARS)}`)
    .join("\n\n---\n\n");

  const { data, usage } = await llm.structured(
    spec,
    rerankSchema,
    "rerank_knowledge",
    [new SystemMessage(PROMPT(topK)), new HumanMessage(`QUESTION:\n${args.question}\n\nPASSAGES:\n\n${context}`)],
    config,
  );
  return { documents: applyReranking(args.documents, data, { topK, minRelevance: args.minRelevance }), usage };
}
