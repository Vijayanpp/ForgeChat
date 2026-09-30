import { z } from "zod";

export const BLOCK_KINDS = [
  "lead",
  "paragraph",
  "heading",
  "subheading",
  "list",
  "quote",
  "insight",
  "remedy",
  "timing",
  "note",
  "phase",
  "cards",
  "blessing",
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

// Every field is required (empty when unused): OpenAI strict mode.
export const blockSchema = z.object({
  kind: z.enum(BLOCK_KINDS),
  title: z.string().describe("Heading text, or the box label for insight/remedy/timing/note/phase; else empty"),
  text: z.string().describe("Body text. **bold** allowed; blank line = line break. Empty for list/cards"),
  items: z.array(z.string()).describe("List items (kind=list); else empty"),
  cards: z.array(z.object({ title: z.string(), text: z.string() })).describe("kind=cards only; else empty"),
});
export type ReportBlock = z.infer<typeof blockSchema>;

export const chapterSchema = z.object({ id: z.string(), blocks: z.array(blockSchema) });
export type ReportChapter = z.infer<typeof chapterSchema>;

export const chapterGroupSchema = z.object({ chapters: z.array(chapterSchema) });

const box = z.object({ title: z.string(), text: z.string() });

export const briefSchema = z.object({
  core_themes: z.array(z.string()).describe("4-6 recurring themes the whole report must stay consistent with"),
  strengths: z.array(z.string()),
  challenges: z.array(z.string()),
  life_windows: z.array(z.string()).describe("Key age windows from the current age onward, e.g. 'Age 27–29: career consolidation'"),
  palm_observations: z.array(z.string()).describe("Features actually visible in the palm photo(s)"),
  personal_message: z.array(z.string()).describe("3-4 paragraphs addressed to the person by name"),
  first_insight: box,
  toc_quote: z.string(),
  how_to_use: z.string(),
  closing_insight: box,
  guardian_note: z.string().describe("Short note for parents if the person is under 18, else empty"),
});
export type ReportBrief = z.infer<typeof briefSchema>;

export interface ReportSubject {
  fullName: string;
  dateOfBirth: string;
  birthTime: string | null;
  birthPlace: string;
  resolvedPlace: string;
  latitude: number;
  longitude: number;
  timezone: string;
  email: string;
}

export interface ReportContent {
  brief: ReportBrief;
  chapters: ReportChapter[];
}
