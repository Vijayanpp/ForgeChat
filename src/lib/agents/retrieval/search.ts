const STOPWORDS = new Set(
  "the and for are but not you your with this that have has had was were will would can could should what when where which who why how our out all any get got just from about into than then them they their there here its it's i'm im do does did dont don't yes no hi hello please thanks thank".split(
    " ",
  ),
);

/** Lowercased content terms with a light plural fold ("prices" ≈ "price"). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** Split a knowledge base into roughly paragraph/section-sized chunks. */
export function chunkKnowledge(text: string, maxChunk = 900): string[] {
  const blocks = text
    .split(/\n\s*\n|(?=^#{1,6}\s)/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (block.length > maxChunk) {
      if (current) chunks.push(current);
      current = "";
      for (let i = 0; i < block.length; i += maxChunk) chunks.push(block.slice(i, i + maxChunk));
      continue;
    }
    if (current && current.length + block.length + 2 > maxChunk) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface KnowledgeChunk {
  id: string;
  index: number;
  content: string;
}

export interface KnowledgeIndex {
  chunks: KnowledgeChunk[];
  termFreqs: Map<string, number>[];
  lengths: number[];
  docFreq: Map<string, number>;
  avgLength: number;
}

export interface SearchHit {
  chunk: KnowledgeChunk;
  score: number;
}

export function buildKnowledgeIndex(text: string): KnowledgeIndex {
  const chunks = chunkKnowledge(text).map((content, index) => ({ id: `c${index + 1}`, index, content }));
  const termFreqs = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of terms(c.content)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = termFreqs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const docFreq = new Map<string, number>();
  for (const tf of termFreqs) for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  const avgLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  return { chunks, termFreqs, lengths, docFreq, avgLength };
}

const K1 = 1.2;
const B = 0.75;

/** BM25 over the chunk index. Only chunks sharing a term with the query are returned. */
export function searchKnowledge(index: KnowledgeIndex, query: string, topK: number): SearchHit[] {
  const n = index.chunks.length;
  const queryTerms = [...new Set(terms(query))];
  if (!n || !queryTerms.length) return [];

  const hits: SearchHit[] = [];
  index.chunks.forEach((chunk, i) => {
    const tf = index.termFreqs[i];
    const norm = K1 * (1 - B + (B * index.lengths[i]) / (index.avgLength || 1));
    let score = 0;
    for (const t of queryTerms) {
      const f = tf.get(t);
      if (!f) continue;
      const df = index.docFreq.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (K1 + 1)) / (f + norm);
    }
    if (score > 0) hits.push({ chunk, score });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}

const indexCache = new Map<string, KnowledgeIndex>();
const INDEX_CACHE_SIZE = 32;

export function knowledgeIndexFor(text: string): KnowledgeIndex {
  const cached = indexCache.get(text);
  if (cached) return cached;
  const index = buildKnowledgeIndex(text);
  if (indexCache.size >= INDEX_CACHE_SIZE) indexCache.delete(indexCache.keys().next().value as string);
  indexCache.set(text, index);
  return index;
}
