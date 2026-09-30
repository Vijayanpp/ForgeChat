import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { hasImages, toLangChainMessages } from "../llm/context";
import { personaSystemPrompt, withStyle } from "../llm/prompts";
import { retrieveKnowledge } from "../retrieval/pipeline";
import { addUsage } from "../types";
import type { Specialist } from "./contract";
import { controlSpec, replySpec } from "./shared";

const answerSchema = z.object({
  reply: z.string().describe("The WhatsApp message to send"),
  answered_from_knowledge: z
    .boolean()
    .describe("true only if every factual claim in the reply comes from KNOWLEDGE"),
});

export const customerServiceSpecialist: Specialist<"customer_service"> = {
  kind: "customer_service",

  async run(ctx) {
    const { config, transcript } = ctx;
    const retrieval = await retrieveKnowledge({
      llm: ctx.llm,
      spec: controlSpec(ctx, 800),
      knowledgeBase: config.knowledge_base,
      transcript,
      config: ctx.runnableConfig,
    });

    if (retrieval.mode === "retrieved" && !retrieval.grounded && config.handoff_when_unknown) {
      return {
        reply: null,
        handoff: true,
        usage: retrieval.usage,
        steps: [...retrieval.steps, "cs:no_evidence"],
        session: { stage: "escalated" },
      };
    }

    const knowledgeBlock =
      retrieval.mode === "empty"
        ? "\n\nKNOWLEDGE: (none provided)"
        : retrieval.context
          ? `\n\nKNOWLEDGE (the only source of facts about the business${
              retrieval.mode === "retrieved" ? "; passages retrieved for this question, most relevant first" : ""
            }):\n"""\n${retrieval.context}\n"""`
          : retrieval.mode === "retrieved"
            ? "\n\nKNOWLEDGE: nothing relevant was found for this question."
            : "";

    const system = [
      personaSystemPrompt({
        personaPrompt: ctx.agent.system_prompt,
        businessName: config.business_name,
        contactName: ctx.contactName,
      }),
      knowledgeBlock,
      `\n\nGrounding rules:
- State business facts (prices, policies, hours, availability) ONLY if they appear in KNOWLEDGE
- If KNOWLEDGE does not cover the question, set answered_from_knowledge=false and reply briefly that you'll check with the team
- Greetings and small talk need no knowledge; set answered_from_knowledge=true for them`,
    ].join("");

    const { data, usage } = await ctx.llm.structured(
      replySpec(ctx, { vision: hasImages(transcript) }),
      answerSchema,
      "customer_service_reply",
      [new SystemMessage(withStyle(system)), ...toLangChainMessages(transcript)],
      ctx.runnableConfig,
    );
    const totalUsage = addUsage(retrieval.usage, usage);

    const unknown = !data.answered_from_knowledge && Boolean(config.knowledge_base.trim());
    if (unknown && config.handoff_when_unknown) {
      return {
        reply: null,
        handoff: true,
        usage: totalUsage,
        steps: [...retrieval.steps, "cs:answer", "cs:unknown"],
        session: { stage: "escalated" },
      };
    }

    return {
      reply: data.reply,
      usage: totalUsage,
      steps: [...retrieval.steps, "cs:answer"],
      session: { stage: "answering" },
    };
  },
};
