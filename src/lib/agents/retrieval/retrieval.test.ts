import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { bot, customer, fakeLlm, lastHumanText } from "../testing/fakes";
import { deduplicateChunks } from "./dedupe";
import { normaliseDecomposition } from "./decompose";
import { normaliseQueries } from "./multi-query";
import { retrieveKnowledge } from "./pipeline";
import { applyReranking } from "./rerank";
import { buildKnowledgeIndex, searchKnowledge } from "./search";

const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed tempor. ".repeat(12);
const section = (title: string, fact: string) => `## ${title}\n${fact}\n\n${filler}`;

const KB = [
  section("Returns", "Products may be returned within 7 days of delivery for a full refund."),
  section("Shipping", "We deliver to Pune, Mumbai and Delhi within 3 business days."),
  section("Warranty", "Electronics carry a 1 year manufacturer warranty."),
  section("Payments", "We accept UPI, cards and cash on delivery."),
  section("Store hours", "Open Monday to Saturday, 10am to 8pm."),
  section("Gift wrap", "Gift wrapping costs Rs 50 per item."),
  section("Loyalty", "Members earn 1 point per Rs 100 spent."),
  section("Bulk orders", "Corporate orders above 50 units get 10% off."),
].join("\n\n");

const spec = { model: "control-model", temperature: 0, maxTokens: 800 };

function question(messages: BaseMessage[]): string {
  return lastHumanText(messages).match(/QUESTION:\n([^\n]+)/)?.[1] ?? "";
}

/** Scores passages the way a sensible reranker would for these fixtures. */
function scorePassages(messages: BaseMessage[]) {
  const q = question(messages).toLowerCase();
  const docs = lastHumanText(messages).split("DOCUMENT ID: ").slice(1);
  return {
    ranked_documents: docs.map((d) => {
      const [id, ...rest] = d.split("\n");
      const content = rest.join("\n");
      const hit = (q.includes("back") && content.includes("refund")) || (q.includes("pune") && content.includes("Pune"));
      return { document_id: id.trim(), relevance_score: hit ? 0.9 : 0.1, reasoning: hit ? "answers it" : "unrelated" };
    }),
  };
}

const multiQuery = (messages: BaseMessage[]) => {
  const q = question(messages);
  const variations = q.includes("back") ? ["return refund policy", "exchange returned products"] : ["delivery shipping Pune"];
  return { original_question: q, queries: variations.map((query, i) => ({ id: `sq${i + 1}`, query, angle: "policy" })) };
};

const twoPartDecomposition = () => ({
  needs_retrieval: true,
  standalone_question: "Can I send my order back, and do you deliver to Pune?",
  requires_decomposition: true,
  reasoning: "two topics",
  sub_questions: [
    { id: "q1", question: "Can I send my order back?", purpose: "returns" },
    { id: "q2", question: "Do you deliver to Pune?", purpose: "delivery" },
  ],
});

describe("BM25 search", () => {
  it("ranks the chunk that contains the query terms first", () => {
    const index = buildKnowledgeIndex(KB);
    const [top] = searchKnowledge(index, "which cities do you deliver to? Pune?", 3);
    expect(top.chunk.content).toContain("Pune");
  });

  it("finds nothing when no term overlaps (the multi-query gap)", () => {
    expect(searchKnowledge(buildKnowledgeIndex(KB), "can I send my stuff back", 3)).toEqual([]);
  });
});

describe("retrieval stage helpers", () => {
  it("falls back to the standalone question and caps sub-questions", () => {
    const one = normaliseDecomposition(
      { needs_retrieval: true, standalone_question: "", requires_decomposition: false, reasoning: "", sub_questions: [] },
      "latest text",
      3,
    );
    expect(one.subQuestions).toEqual(["latest text"]);

    const many = normaliseDecomposition(
      {
        needs_retrieval: true,
        standalone_question: "q",
        requires_decomposition: true,
        reasoning: "",
        sub_questions: ["a", "A ", "b", "c", "d"].map((question, i) => ({ id: `q${i}`, question, purpose: "" })),
      },
      "q",
      3,
    );
    expect(many.subQuestions).toEqual(["a", "b", "c"]);
  });

  it("always searches the question itself and drops near-duplicate queries", () => {
    const queries = normaliseQueries(
      "Return window?",
      {
        original_question: "Return window?",
        queries: ["return window", "refund policy", "Refund policy!"].map((query, i) => ({ id: `${i}`, query, angle: "" })),
      },
      3,
    );
    expect(queries).toEqual(["Return window?", "refund policy"]);
  });

  it("merges chunks found by several queries", () => {
    const chunk = { id: "c1", index: 0, content: "x", lexicalScore: 1, sourceQueries: ["a"] };
    const [merged] = deduplicateChunks([chunk, { ...chunk, lexicalScore: 3, sourceQueries: ["b"] }]);
    expect(merged).toMatchObject({ sourceQueries: ["a", "b"], lexicalScore: 3 });
  });

  it("drops invented ids and weak evidence when reranking", () => {
    const docs = ["c1", "c2", "c3"].map((id, index) => ({ id, index, content: id, lexicalScore: 1, sourceQueries: [] }));
    const ranked = applyReranking(
      docs,
      {
        ranked_documents: [
          { document_id: "c9", relevance_score: 1, reasoning: "" },
          { document_id: "c2", relevance_score: 0.2, reasoning: "" },
          { document_id: "c3", relevance_score: 0.6, reasoning: "" },
          { document_id: "c1", relevance_score: 1.7, reasoning: "" },
        ],
      },
      { topK: 5, minRelevance: 0.35 },
    );
    expect(ranked.map((d) => [d.id, d.relevance])).toEqual([
      ["c1", 1],
      ["c3", 0.6],
    ]);
  });
});

describe("retrieveKnowledge pipeline", () => {
  it("passes small knowledge bases whole without any model call", async () => {
    const llm = fakeLlm({});
    const result = await retrieveKnowledge({ llm, spec, knowledgeBase: "Open 9-5.", transcript: [customer("hours?")] });
    expect(result).toMatchObject({ mode: "full", context: "Open 9-5.", grounded: true });
    expect(llm.calls).toEqual([]);
  });

  it("skips retrieval for small talk after decomposition", async () => {
    const llm = fakeLlm({
      decompose_question: () => ({
        needs_retrieval: false,
        standalone_question: "thanks",
        requires_decomposition: false,
        reasoning: "small talk",
        sub_questions: [],
      }),
    });
    const result = await retrieveKnowledge({ llm, spec, knowledgeBase: KB, transcript: [customer("thanks!")] });
    expect(result).toMatchObject({ mode: "skipped", grounded: true, context: "" });
    expect(llm.calls.map((c) => c.name)).toEqual(["decompose_question"]);
  });

  it("decomposes, expands each sub-question, searches, dedupes and reranks", async () => {
    const llm = fakeLlm({
      decompose_question: twoPartDecomposition,
      generate_search_queries: multiQuery,
      rerank_knowledge: scorePassages,
    });
    const result = await retrieveKnowledge({
      llm,
      spec,
      knowledgeBase: KB,
      transcript: [bot("Hi! How can I help?"), customer("can I send stuff back? and do u come to pune")],
    });

    expect(result.mode).toBe("retrieved");
    expect(result.grounded).toBe(true);
    expect(result.subQuestions).toEqual(["Can I send my order back?", "Do you deliver to Pune?"]);
    const returns = result.questionResults.find((r) => r.question.includes("back"))!;
    expect(returns.queries).toEqual(["Can I send my order back?", "return refund policy", "exchange returned products"]);
    expect(result.context).toContain("full refund");
    expect(result.context).toContain("Pune, Mumbai");
    expect(result.context).not.toContain("warranty");
    // One final rerank is skipped: evidence already fits finalTopK.
    expect(llm.calls.map((c) => c.name).sort()).toEqual([
      "decompose_question",
      "generate_search_queries",
      "generate_search_queries",
      "rerank_knowledge",
      "rerank_knowledge",
    ]);
    expect(llm.calls.every((c) => c.model === "control-model")).toBe(true);
    expect(result.steps).toContain("rag:decompose:2");
  });

  it("runs a global rerank against the standalone question when evidence must be cut", async () => {
    const llm = fakeLlm({
      decompose_question: twoPartDecomposition,
      generate_search_queries: multiQuery,
      rerank_knowledge: scorePassages,
    });
    const result = await retrieveKnowledge({
      llm,
      spec,
      knowledgeBase: KB,
      transcript: [customer("send back? pune?")],
      options: { finalTopK: 1 },
    });
    expect(llm.calls.filter((c) => c.name === "rerank_knowledge")).toHaveLength(3);
    expect(result.documents).toHaveLength(1);
  });

  it("degrades to lexical evidence when the model stages fail", async () => {
    const failing = () => {
      throw new Error("model down");
    };
    const llm = fakeLlm({
      decompose_question: failing,
      generate_search_queries: failing,
      rerank_knowledge: failing,
    });
    const result = await retrieveKnowledge({
      llm,
      spec,
      knowledgeBase: KB,
      transcript: [customer("Do you deliver to Pune?")],
    });
    expect(result.mode).toBe("retrieved");
    expect(result.context).toContain("Pune");
    expect(result.steps).toEqual(
      expect.arrayContaining(["rag:decompose_failed", "rag:multi_query_failed", "rag:rerank_failed"]),
    );
  });

  it("reports ungrounded when nothing relevant exists", async () => {
    const llm = fakeLlm({
      decompose_question: () => ({
        needs_retrieval: true,
        standalone_question: "Do you sell cars?",
        requires_decomposition: false,
        reasoning: "",
        sub_questions: [],
      }),
      generate_search_queries: () => ({ original_question: "", queries: [{ id: "1", query: "automobile vehicle", angle: "" }] }),
    });
    const result = await retrieveKnowledge({ llm, spec, knowledgeBase: KB, transcript: [customer("sell cars?")] });
    expect(result).toMatchObject({ mode: "retrieved", grounded: false, context: "" });
    expect(llm.calls.map((c) => c.name)).not.toContain("rerank_knowledge");
  });
});
