import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, type MessageContent } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { VedicChart } from "../astrology/chart";
import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import { addUsage, ZERO_USAGE, type Usage } from "../types";
import { CHAPTER_GROUPS, CHAPTERS, chapterTitle } from "./outline";
import { ageOn } from "./render";
import {
  briefSchema,
  chapterGroupSchema,
  type ReportBrief,
  type ReportChapter,
  type ReportContent,
  type ReportSubject,
} from "./schema";

export interface GenerateReportInput {
  llm: LlmToolkit;
  spec: ModelSpec;
  businessName: string;
  personaPrompt: string;
  subject: ReportSubject;
  chart: VedicChart;
  palmImages: string[];
  /** Earlier free readings from the chat, for consistency. */
  earlierReadings: string;
  now: Date;
  config?: RunnableConfig;
}

export function chartFacts(chart: VedicChart): string {
  return [
    chart.ascendant ? `Ascendant (Lagna): ${chart.ascendant.sign}` : "Ascendant: not available (birth time unknown) — do not mention an ascendant sign",
    `Moon sign (Rashi): ${chart.moon.sign}`,
    `Nakshatra: ${chart.nakshatra.name}, Pada ${chart.nakshatra.pada} (lord: ${chart.nakshatra.lord})`,
    "Ayanamsa: Lahiri (sidereal)",
  ].join("\n");
}

const WRITING_RULES = `WRITING RULES
- Warm, respectful, specific; address the person by first name and "you". Use he/she only if the gender is obvious from context; otherwise avoid gendered pronouns.
- Traditional-interpretation framing: "may", "traditionally suggests", "can indicate". Never certainty, never fear.
- Never predict death, illness, accidents, divorce, exact marriage dates, exam results or exact money amounts. No medical, legal or financial advice.
- Use ONLY the chart facts given; do not invent planetary positions, houses, dashas or yogas.
- Palm statements only about features visible in the photo; say when something cannot be seen clearly.
- Age-appropriate: write for the person's CURRENT age and life stage.
- Blocks: start every chapter with one "lead" block. Use "heading"/"subheading" for sections, and mix in "insight", "quote", "remedy", "timing", "note", "phase", "list" and "cards" blocks the way a premium printed report does. Keep paragraphs 2-5 sentences. **bold** sparingly.
- Remedies: free, safe, practical habits and gentle traditional practices. Never sell gemstones, pujas or paid services.`;

function profileText(input: GenerateReportInput): string {
  const age = ageOn(input.subject.dateOfBirth, input.now);
  return `PERSON
Name: ${input.subject.fullName}
Age today: ${age} (born ${input.subject.dateOfBirth}${input.subject.birthTime ? ` at ${input.subject.birthTime}` : ", birth time unknown"})
Birth place: ${input.subject.resolvedPlace || input.subject.birthPlace}

CHART FACTS (computed; use exactly)
${chartFacts(input.chart)}`;
}

function withImages(text: string, images: string[]): HumanMessage {
  if (!images.length) return new HumanMessage(text);
  const content: MessageContent = [
    { type: "text", text },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
  ];
  return new HumanMessage({ content });
}

function briefToText(brief: ReportBrief): string {
  return [
    `Core themes: ${brief.core_themes.join("; ")}`,
    `Strengths: ${brief.strengths.join("; ")}`,
    `Challenges: ${brief.challenges.join("; ")}`,
    `Life windows: ${brief.life_windows.join("; ")}`,
    `Palm observations: ${brief.palm_observations.join("; ")}`,
  ].join("\n");
}

export function missingChapters(ids: string[], chapters: ReportChapter[]): string[] {
  const present = new Set(chapters.filter((c) => c.blocks.length >= 3).map((c) => c.id));
  return ids.filter((id) => !present.has(id));
}

export async function generateReportContent(
  input: GenerateReportInput,
): Promise<{ content: ReportContent; usage: Usage; steps: string[] }> {
  const isMinor = ageOn(input.subject.dateOfBirth, input.now) < 18;
  const persona = `You are the senior reader at ${input.businessName || "AskMyPalm"}, writing a premium personalized Vedic astrology and palm analysis report.${
    input.personaPrompt ? `\nBrand voice notes: ${input.personaPrompt}` : ""
  }\n\n${WRITING_RULES}`;
  const profile = profileText(input);
  const earlier = input.earlierReadings ? `\n\nEARLIER FREE READINGS GIVEN IN CHAT (stay consistent):\n${input.earlierReadings}` : "";

  const State = Annotation.Root({
    brief: Annotation<ReportBrief | null>,
    group: Annotation<string[]>,
    chapters: Annotation<ReportChapter[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    usage: Annotation<Usage>({ reducer: addUsage, default: () => ZERO_USAGE }),
    steps: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  });
  type S = typeof State.State;

  const writeBrief = async (_s: S, config?: RunnableConfig): Promise<Partial<S>> => {
    const { data, usage } = await input.llm.structured(
      { ...input.spec, maxTokens: 3000 },
      briefSchema,
      "report_brief",
      [
        new SystemMessage(persona),
        withImages(
          `${profile}${earlier}\n\nStudy the palm photo(s) and the chart facts, then write the reading brief that every chapter will follow, plus the front-matter texts.${
            isMinor ? " The person is a minor: include a guardian_note for parents." : " The person is an adult: guardian_note must be empty."
          }`,
          input.palmImages,
        ),
      ],
      config,
    );
    return { brief: data, usage, steps: ["report:brief"] };
  };

  const fanOut = (s: S) => CHAPTER_GROUPS.map((group) => new Send("write_group", { ...s, group }));

  const writeGroup = async (s: S, config?: RunnableConfig): Promise<Partial<S>> => {
    const specs = s.group.map((id) => CHAPTERS.find((c) => c.id === id)!);
    const images = s.group.includes("palm") ? input.palmImages : [];
    const ask = (ids: string[]) =>
      input.llm.structured(
        { ...input.spec, maxTokens: 12_000 },
        chapterGroupSchema,
        "report_chapters",
        [
          new SystemMessage(persona),
          withImages(
            `${profile}${earlier}\n\nREADING BRIEF (the whole report follows it)\n${briefToText(s.brief!)}\n\nWrite these chapters in full (each roughly one printed A4 page, 450-700 words), returning one entry per id:\n${specs
              .filter((c) => ids.includes(c.id))
              .map((c) => `- id "${c.id}" — "${chapterTitle(c, isMinor)}": ${c.guide}`)
              .join("\n")}`,
            images,
          ),
        ],
        config,
      );

    let usage = ZERO_USAGE;
    const first = await ask(s.group);
    usage = addUsage(usage, first.usage);
    let chapters = first.data.chapters.filter((c) => s.group.includes(c.id));
    const missing = missingChapters(s.group, chapters);
    if (missing.length) {
      const retry = await ask(missing);
      usage = addUsage(usage, retry.usage);
      chapters = [...chapters.filter((c) => !missing.includes(c.id)), ...retry.data.chapters.filter((c) => missing.includes(c.id))];
    }
    const stillMissing = missingChapters(s.group, chapters);
    if (stillMissing.length) throw new Error(`report chapters missing after retry: ${stillMissing.join(", ")}`);
    return { chapters, usage, steps: [`report:${s.group.join("+")}`] };
  };

  const graph = new StateGraph(State)
    .addNode("write_brief", writeBrief)
    .addNode("write_group", writeGroup)
    .addEdge(START, "write_brief")
    .addConditionalEdges("write_brief", fanOut, ["write_group"])
    .addEdge("write_group", END)
    .compile();

  const final = await graph.invoke({ brief: null, group: [] }, { ...input.config, runName: "palm_report" });
  const order = new Map(CHAPTERS.map((c, i) => [c.id, i]));
  return {
    content: {
      brief: final.brief!,
      chapters: [...final.chapters].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)),
    },
    usage: final.usage,
    steps: final.steps,
  };
}
