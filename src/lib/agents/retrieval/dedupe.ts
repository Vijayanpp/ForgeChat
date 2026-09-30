import type { SearchHit } from "./search";

export interface RetrievedChunk {
  id: string;
  index: number;
  content: string;
  /** Every query (and sub-question) that surfaced this chunk. */
  sourceQueries: string[];
  lexicalScore: number;
  relevance?: number;
  rerankReason?: string;
}

export function hitsToChunks(hits: SearchHit[], sourceQuery: string): RetrievedChunk[] {
  return hits.map((h) => ({
    id: h.chunk.id,
    index: h.chunk.index,
    content: h.chunk.content,
    sourceQueries: [sourceQuery],
    lexicalScore: h.score,
  }));
}

/**
 * Merge chunks found by several queries: keep one copy, union the
 * source queries, keep the best lexical and rerank scores.
 */
export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const c of chunks) {
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, { ...c, sourceQueries: [...new Set(c.sourceQueries)] });
      continue;
    }
    for (const q of c.sourceQueries) if (!existing.sourceQueries.includes(q)) existing.sourceQueries.push(q);
    existing.lexicalScore = Math.max(existing.lexicalScore, c.lexicalScore);
    if (c.relevance !== undefined && (existing.relevance === undefined || c.relevance > existing.relevance)) {
      existing.relevance = c.relevance;
      existing.rerankReason = c.rerankReason;
    }
  }
  return [...byId.values()];
}

/** Chunks found by more queries rank higher, then by lexical score. */
export function byLexicalEvidence(a: RetrievedChunk, b: RetrievedChunk): number {
  return b.sourceQueries.length - a.sourceQueries.length || b.lexicalScore - a.lexicalScore;
}
