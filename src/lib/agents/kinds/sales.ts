import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { latestCustomerText, toLangChainMessages, transcriptToText } from "../llm/context";
import { personaSystemPrompt, withStyle } from "../llm/prompts";
import { retrieveKnowledge } from "../retrieval/pipeline";
import { addUsage, ZERO_USAGE } from "../types";
import type { QualificationField } from "./catalog";
import type { Specialist } from "./contract";
import { asRecord, asStringRecord, controlSpec, replySpec } from "./shared";

export function missingFields(fields: QualificationField[], known: Record<string, string>) {
  return fields.filter((f) => !known[f.key]?.trim());
}

export const salesSpecialist: Specialist<"sales"> = {
  kind: "sales",

  async run(ctx) {
    const { config, transcript } = ctx;
    const fields = config.qualification_fields;
    const slots = asRecord(ctx.session.slots);
    const known = asStringRecord(slots.qualification);
    let summary = ctx.session.summary;
    let usage = ZERO_USAGE;
    const steps: string[] = [];

    const extract = async () => {
      if (!latestCustomerText(transcript)) return null;
      const keys = fields.map((f) => f.key) as [string, ...string[]];
      const extractSchema = z.object({
        updates: z
          .array(z.object({ key: z.enum(keys), value: z.string().max(300) }))
          .describe("Only fields the customer has clearly stated"),
        summary: z.string().max(600).describe("2-3 sentence running summary of the lead for the sales team"),
      });

      const fieldList = fields.map((f) => `- ${f.key}: ${f.label}`).join("\n");
      return ctx.llm.structured(
        controlSpec(ctx),
        extractSchema,
        "sales_qualification",
        [
          new SystemMessage(
            `Extract lead qualification facts from a sales conversation. Never guess; omit anything not clearly stated.\nFields:\n${fieldList}\nAlready known: ${JSON.stringify(known)}\nPrevious summary: ${summary ?? "(none)"}`,
          ),
          new HumanMessage(transcriptToText(transcript)),
        ],
        ctx.runnableConfig,
      );
    };

    const [retrieval, extracted] = await Promise.all([
      retrieveKnowledge({
        llm: ctx.llm,
        spec: controlSpec(ctx, 800),
        knowledgeBase: config.product_summary,
        transcript,
        config: ctx.runnableConfig,
      }),
      extract(),
    ]);

    usage = addUsage(usage, retrieval.usage);
    steps.push(...retrieval.steps);
    if (extracted) {
      usage = addUsage(usage, extracted.usage);
      for (const u of extracted.data.updates) if (u.value.trim()) known[u.key] = u.value.trim();
      summary = extracted.data.summary || summary;
      steps.push("sales:extract");
    }

    const missing = missingFields(fields, known);
    const qualified = missing.length === 0;
    const knownText = fields
      .filter((f) => known[f.key])
      .map((f) => `- ${f.label}: ${known[f.key]}`)
      .join("\n");

    const instruction = qualified
      ? `The lead is fully qualified. Summarise their need in one line and propose the next step${
          config.next_step_link ? ` using this link: ${config.next_step_link}` : " (a call or demo)"
        }.`
      : `Still unknown: ${missing.map((f) => f.label).join(", ")}. Respond helpfully to what they said, then naturally ask about "${missing[0].label}" (one question only).`;

    const system = [
      personaSystemPrompt({
        personaPrompt: ctx.agent.system_prompt,
        businessName: config.business_name,
        contactName: ctx.contactName,
      }),
      retrieval.context
        ? `\n\nPRODUCT / OFFER (only source of product facts${
            retrieval.mode === "retrieved" ? "; passages retrieved for this question, most relevant first" : ""
          }):\n"""\n${retrieval.context}\n"""`
        : retrieval.mode === "retrieved"
          ? "\n\nPRODUCT / OFFER: nothing relevant was found for this question; do not state product facts."
          : "",
      `\n\nWhat we know about this lead:\n${knownText || "(nothing yet)"}`,
      `\n\n[This turn: ${instruction}]`,
    ].join("");

    const reply = await ctx.llm.chat(
      replySpec(ctx),
      [new SystemMessage(withStyle(system)), ...toLangChainMessages(transcript, { includeImages: false })],
      ctx.runnableConfig,
    );
    steps.push(qualified ? "sales:next_step" : "sales:discover");

    return {
      reply: reply.text,
      usage: addUsage(usage, reply.usage),
      steps,
      session: {
        stage: qualified ? "qualified" : "qualifying",
        summary,
        slots: { ...slots, qualification: known },
      },
    };
  },
};
