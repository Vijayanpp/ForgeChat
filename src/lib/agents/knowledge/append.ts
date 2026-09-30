/** File name → readable section title ("refund_policy-v2.pdf" → "refund policy v2"). */
export function sourceTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base || "Uploaded document";
}

/**
 * Append a document as its own "## <title>" section so retrieval chunks
 * start on a boundary. Truncates to `max` characters, cutting at a
 * paragraph break where possible.
 */
export function appendKnowledge(
  current: string,
  fileName: string,
  text: string,
  max: number,
): { value: string; added: number; truncated: boolean } {
  const prefix = current.trim() ? `${current.trimEnd()}\n\n` : "";
  const section = `## ${sourceTitle(fileName)}\n\n${text.trim()}`;
  const room = max - prefix.length;
  if (room <= 0) return { value: current, added: 0, truncated: true };
  if (section.length <= room) return { value: prefix + section, added: section.length, truncated: false };

  const slice = section.slice(0, room);
  const cut = slice.lastIndexOf("\n\n");
  const kept = (cut > room * 0.5 ? slice.slice(0, cut) : slice).trimEnd();
  return { value: prefix + kept, added: kept.length, truncated: true };
}
