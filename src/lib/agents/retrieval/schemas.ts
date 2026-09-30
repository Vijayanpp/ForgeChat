import { z } from "zod";

// Array/number bounds are enforced in code, not in the schemas:
// OpenAI strict structured output rejects some JSON-schema keywords.

export const decompositionSchema = z.object({
  needs_retrieval: z
    .boolean()
    .describe("false for greetings, thanks, small talk or anything that needs no business facts"),
  standalone_question: z
    .string()
    .describe(
      "The customer's latest request as one self-contained question, with references like 'it' or 'that plan' resolved from the conversation",
    ),
  requires_decomposition: z.boolean(),
  reasoning: z.string().describe("One short sentence"),
  sub_questions: z.array(
    z.object({
      id: z.string().describe("q1, q2, ..."),
      question: z.string().describe("One focused, self-contained question"),
      purpose: z.string().describe("Why answering it helps answer the customer"),
    }),
  ),
});
export type Decomposition = z.infer<typeof decompositionSchema>;

export const multiQuerySchema = z.object({
  original_question: z.string(),
  queries: z.array(
    z.object({
      id: z.string().describe("sq1, sq2, ..."),
      query: z.string().describe("Short keyword-style search query"),
      angle: z.string().describe("The retrieval angle this query represents"),
    }),
  ),
});
export type MultiQuery = z.infer<typeof multiQuerySchema>;

export const rerankSchema = z.object({
  ranked_documents: z.array(
    z.object({
      document_id: z.string(),
      relevance_score: z.number().describe("0 to 1"),
      reasoning: z.string().describe("One short sentence"),
    }),
  ),
});
export type Reranking = z.infer<typeof rerankSchema>;
