import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

import { latestCustomerText, transcriptToText } from "../llm/context";
import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import { addUsage, ZERO_USAGE, type ChatTurn, type Usage } from "../types";
import { decomposeQuestion } from "./decompose";
import { byLexicalEvidence, deduplicateChunks, hitsToChunks, type RetrievedChunk } from "./dedupe";
import { generateSearchQueries } from "./multi-query";
import { rerankChunks } from "./rerank";
import { knowledgeIndexFor, searchKnowledge, type KnowledgeIndex } from "./search";

export interface RetrievalOptions {
  /** Knowledge bases up to this size are passed whole; no retrieval runs. */
  fullContextChars: number;
  maxSubQuestions: number;
  queriesPerQuestion: number;
  hitsPerQuery: number;
  candidatesPerQuestion: number;
  topKPerQuestion: number;
  finalTopK: number;
  minRelevance: number;
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  fullContextChars: 6000,
  maxSubQuestions: 3,
  queriesPerQuestion: 3,
  hitsPerQuery: 4,
  candidatesPerQuestion: 8,
  topKPerQuestion: 4,
  finalTopK: 6,
  minRelevance: 0.35,
};

export interface QuestionRetrieval {
  question: string;
  queries: string[];
  candidateCount: number;
  documents: RetrievedChunk[];
  reranked: boolean;
}

export interface KnowledgeRetrieval {
  /**
   * empty: no knowledge configured · full: small enough to pass whole ·
   * skipped: the turn needs no business facts · retrieved: pipeline ran
   */
  mode: "empty" | "full" | "skipped" | "retrieved";
  context: string;
  /** false only when the pipeline ran and found no relevant evidence. */
  grounded: boolean;
  standaloneQuestion: string;
  subQuestions: string[];
  questionResults: QuestionRetrieval[];
  documents: RetrievedChunk[];
  usage: Usage;
  steps: string[];
}

export function formatKnowledgeContext(documents: RetrievedChunk[]): string {
  return documents
    .map((d, i) => {
      const score = d.relevance === undefined ? "" : ` · relevance ${d.relevance.toFixed(2)}`;
      return `[Source ${i + 1}${score}]\n${d.content}`;
    })
    .join("\n\n---\n\n");
}

function buildRetrievalGraph(llm: LlmToolkit, spec: ModelSpec, index: KnowledgeIndex, opts: RetrievalOptions) {
  const State = Annotation.Root({
    latest: Annotation<string>,
    conversation: Annotation<string>,
    needsRetrieval: Annotation<boolean>,
    standaloneQuestion: Annotation<string>,
    subQuestions: Annotation<string[]>,
    /** Set per branch via Send; never written back. */
    currentQuestion: Annotation<string>,
    questionResults: Annotation<QuestionRetrieval[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    documents: Annotation<RetrievedChunk[]>,
    usage: Annotation<Usage>({ reducer: addUsage, default: () => ZERO_USAGE }),
    steps: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  });
  type S = typeof State.State;

  const decompose = async (s: S, config?: RunnableConfig): Promise<Partial<S>> => {
    try {
      const { result, usage } = await decomposeQuestion(
        llm,
        spec,
        { conversation: s.conversation, latest: s.latest, maxQuestions: opts.maxSubQuestions },
        config,
      );
      return {
        needsRetrieval: result.needsRetrieval,
        standaloneQuestion: result.standaloneQuestion,
        subQuestions: result.subQuestions,
        usage,
        steps: [result.needsRetrieval ? `rag:decompose:${result.subQuestions.length}` : "rag:not_needed"],
      };
    } catch {
      return {
        needsRetrieval: true,
        standaloneQuestion: s.latest,
        subQuestions: [s.latest],
        steps: ["rag:decompose_failed"],
      };
    }
  };

  const fanOut = (s: S) =>
    s.needsRetrieval ? s.subQuestions.map((q) => new Send("retrieve_question", { ...s, currentQuestion: q })) : END;

  const retrieveQuestion = async (s: S, config?: RunnableConfig): Promise<Partial<S>> => {
    const question = s.currentQuestion;
    let usage = ZERO_USAGE;
    const steps: string[] = [];

    let queries = [question];
    try {
      const generated = await generateSearchQueries(
        llm,
        spec,
        { question, maxQueries: opts.queriesPerQuestion },
        config,
      );
      queries = generated.queries;
      usage = addUsage(usage, generated.usage);
    } catch {
      steps.push("rag:multi_query_failed");
    }

    const found = queries.flatMap((q) => hitsToChunks(searchKnowledge(index, q, opts.hitsPerQuery), q));
    const candidates = deduplicateChunks(found).sort(byLexicalEvidence).slice(0, opts.candidatesPerQuestion);

    let documents: RetrievedChunk[] = [];
    let reranked = false;
    if (candidates.length) {
      try {
        const ranked = await rerankChunks(
          llm,
          spec,
          { question, documents: candidates, topK: opts.topKPerQuestion, minRelevance: opts.minRelevance },
          config,
        );
        documents = ranked.documents;
        reranked = true;
        usage = addUsage(usage, ranked.usage);
      } catch {
        documents = candidates.slice(0, opts.topKPerQuestion);
        steps.push("rag:rerank_failed");
      }
    }

    return {
      questionResults: [{ question, queries, candidateCount: candidates.length, documents, reranked }],
      usage,
      steps,
    };
  };

  const aggregate = async (s: S, config?: RunnableConfig): Promise<Partial<S>> => {
    const merged = deduplicateChunks(s.questionResults.flatMap((r) => r.documents)).sort(
      (a, b) => (b.relevance ?? -1) - (a.relevance ?? -1) || byLexicalEvidence(a, b),
    );
    const queryCount = s.questionResults.reduce((n, r) => n + r.queries.length, 0);
    const steps = [`rag:queries:${queryCount}`];

    // Per-question ranking is final when there is one question or nothing to cut.
    if (s.questionResults.length <= 1 || merged.length <= opts.finalTopK) {
      return { documents: merged.slice(0, opts.finalTopK), steps: [...steps, `rag:evidence:${Math.min(merged.length, opts.finalTopK)}`] };
    }

    try {
      const ranked = await rerankChunks(
        llm,
        spec,
        { question: s.standaloneQuestion, documents: merged, topK: opts.finalTopK, minRelevance: opts.minRelevance },
        config,
      );
      return { documents: ranked.documents, usage: ranked.usage, steps: [...steps, `rag:evidence:${ranked.documents.length}`] };
    } catch {
      const documents = merged.slice(0, opts.finalTopK);
      return { documents, steps: [...steps, "rag:final_rerank_failed", `rag:evidence:${documents.length}`] };
    }
  };

  return new StateGraph(State)
    .addNode("decompose", decompose)
    .addNode("retrieve_question", retrieveQuestion)
    .addNode("aggregate", aggregate)
    .addEdge(START, "decompose")
    .addConditionalEdges("decompose", fanOut, ["retrieve_question", END])
    .addEdge("retrieve_question", "aggregate")
    .addEdge("aggregate", END)
    .compile();
}

/**
 * Knowledge retrieval for one customer turn:
 * decompose → per sub-question (multi-query → BM25 search → dedupe → rerank)
 * → global dedupe → final rerank → evidence.
 * Every LLM stage degrades to a deterministic fallback, so retrieval
 * never fails a turn.
 */
export async function retrieveKnowledge(args: {
  llm: LlmToolkit;
  spec: ModelSpec;
  knowledgeBase: string;
  transcript: ChatTurn[];
  config?: RunnableConfig;
  options?: Partial<RetrievalOptions>;
}): Promise<KnowledgeRetrieval> {
  const opts = { ...DEFAULT_RETRIEVAL, ...args.options };
  const knowledge = args.knowledgeBase.trim();
  const latest = latestCustomerText(args.transcript);
  const base: KnowledgeRetrieval = {
    mode: "empty",
    context: "",
    grounded: false,
    standaloneQuestion: latest,
    subQuestions: [],
    questionResults: [],
    documents: [],
    usage: ZERO_USAGE,
    steps: [],
  };

  if (!knowledge) return { ...base, steps: ["rag:empty"] };
  if (knowledge.length <= opts.fullContextChars) {
    return { ...base, mode: "full", context: knowledge, grounded: true, steps: ["rag:full"] };
  }
  if (!latest || /^\[Customer sent a photo\]$/.test(latest)) {
    return { ...base, mode: "skipped", grounded: true, steps: ["rag:no_text"] };
  }

  const graph = buildRetrievalGraph(args.llm, args.spec, knowledgeIndexFor(knowledge), opts);
  const final = await graph.invoke(
    {
      latest,
      conversation: transcriptToText(args.transcript.slice(0, -1), 8),
      needsRetrieval: true,
      standaloneQuestion: latest,
      subQuestions: [],
      currentQuestion: "",
      documents: [],
    },
    { ...args.config, runName: "knowledge_retrieval" },
  );

  if (!final.needsRetrieval) {
    return { ...base, mode: "skipped", grounded: true, usage: final.usage, steps: final.steps };
  }
  return {
    mode: "retrieved",
    context: formatKnowledgeContext(final.documents),
    grounded: final.documents.length > 0,
    standaloneQuestion: final.standaloneQuestion,
    subQuestions: final.subQuestions,
    questionResults: final.questionResults,
    documents: final.documents,
    usage: final.usage,
    steps: final.steps,
  };
}
