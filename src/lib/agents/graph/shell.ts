import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { AgentRuntimeConfig } from "../config";
import type { AgentKindConfigMap } from "../kinds/catalog";
import { AGENT_KIND_CATALOG } from "../kinds/catalog";
import type {
  ConversationRefs,
  SpecialistContext,
  SpecialistResult,
  SpecialistServices,
} from "../kinds/contract";
import { getSpecialist } from "../kinds/registry";
import type { LlmToolkit } from "../llm/toolkit";
import {
  addUsage,
  ZERO_USAGE,
  type AgentKind,
  type ChatTurn,
  type GateFacts,
  type RuntimeAgent,
  type SessionState,
  type SkipReason,
  type Usage,
} from "../types";
import { latestCustomerText } from "../llm/context";
import { attachPaymentOffer } from "../kinds/palm-offer";
import type { PalmReadingConfig } from "../kinds/catalog";
import { classifyTurn, requiresHandoff, type Classification } from "./classify";
import { evaluateGate } from "./gate";
import { checkReply, stripViolations } from "./guard";

export const DEFAULT_HANDOFF_MESSAGE =
  "Thanks for your patience! I'm bringing in a member of our team, and they'll reply here shortly.";

export interface AgentGraphDeps {
  llm: LlmToolkit;
  services: SpecialistServices;
  runtime: AgentRuntimeConfig;
  now?: () => Date;
}

export interface AgentTurnInput {
  agent: RuntimeAgent;
  kind: AgentKind;
  config: AgentKindConfigMap[AgentKind];
  transcript: ChatTurn[];
  session: SessionState;
  contactName: string;
  gateFacts: GateFacts;
  conversationKey: string;
  refs?: ConversationRefs | null;
}

const last = <T>(_a: T, b: T) => b;

export const AgentGraphState = Annotation.Root({
  input: Annotation<AgentTurnInput>({ reducer: last }),
  skipReason: Annotation<SkipReason | null>({ reducer: last, default: () => null }),
  classification: Annotation<Classification | null>({ reducer: last, default: () => null }),
  reply: Annotation<string | null>({ reducer: last, default: () => null }),
  handoff: Annotation<boolean>({ reducer: last, default: () => false }),
  sessionPatch: Annotation<SpecialistResult["session"]>({
    reducer: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }),
    default: () => ({}),
  }),
  nodePath: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  usage: Annotation<Usage>({ reducer: addUsage, default: () => ZERO_USAGE }),
});

export type AgentGraphStateType = typeof AgentGraphState.State;
type Update = Partial<AgentGraphStateType>;

export function buildAgentGraph(deps: AgentGraphDeps) {
  const now = deps.now ?? (() => new Date());

  const gate = (s: AgentGraphStateType): Update => {
    const reason = evaluateGate(s.input.gateFacts, deps.runtime, now());
    return { skipReason: reason, nodePath: [reason ? `gate:skip:${reason}` : "gate"] };
  };

  const classify = async (s: AgentGraphStateType, config?: RunnableConfig): Promise<Update> => {
    const { input } = s;
    const info = AGENT_KIND_CATALOG[input.kind];
    const result = await classifyTurn({
      transcript: input.transcript,
      purpose: `${info.label} — ${info.description}${
        input.config.business_name ? ` for ${input.config.business_name}` : ""
      }${
        "paid_report_enabled" in input.config && input.config.paid_report_enabled
          ? ". Also in scope: paying for the detailed report, payment screenshots, and sharing name, birth date/time/place and email for it"
          : ""
      }`,
      handoffKeywords: input.config.handoff_keywords,
      llm: deps.llm,
      runtime: deps.runtime,
      runnableConfig: config,
    });
    return {
      classification: result.classification,
      handoff: requiresHandoff(result.classification),
      usage: result.usage,
      nodePath: [`classify:${result.classification.intent}${result.source === "model" ? "" : `:${result.source}`}`],
    };
  };

  const specialist = async (s: AgentGraphStateType, config?: RunnableConfig): Promise<Update> => {
    const { input } = s;
    const ctx: SpecialistContext = {
      agent: input.agent,
      config: input.config,
      transcript: input.transcript,
      session: input.session,
      contactName: input.contactName,
      conversationKey: input.conversationKey,
      refs: input.refs ?? null,
      llm: deps.llm,
      runtime: deps.runtime,
      services: deps.services,
      now: now(),
      runnableConfig: config,
    };
    const result = await getSpecialist(input.kind).run(ctx as never);
    return {
      reply: result.reply,
      handoff: Boolean(result.handoff),
      sessionPatch: result.session ?? {},
      usage: result.usage,
      nodePath: [`specialist:${input.kind}`, ...result.steps],
    };
  };

  const guard = async (s: AgentGraphStateType, config?: RunnableConfig): Promise<Update> => {
    const first = checkReply(s.reply ?? "");
    let update: Update;
    if (first.violations.length === 0) {
      update = { reply: first.text, nodePath: ["guard:pass"] };
    } else {
      // One rewrite with the control model; no specialist re-run, so
      // side effects (bookings) never repeat.
      const rewrite = await deps.llm.chat(
        { model: deps.runtime.controlModel, temperature: 0.3, maxTokens: 500 },
        [
          new SystemMessage(
            `Rewrite this WhatsApp message so it fixes these problems: ${first.violations.join("; ")}. Keep every fact, the language and the tone. Never mention AI or models. Output only the message.`,
          ),
          new HumanMessage(first.text || "(empty)"),
        ],
        config,
      );
      const second = checkReply(rewrite.text);
      if (second.violations.length === 0) {
        update = { reply: second.text, usage: rewrite.usage, nodePath: ["guard:rewritten"] };
      } else {
        const salvaged = stripViolations(second.text);
        update = salvaged
          ? { reply: salvaged, usage: rewrite.usage, nodePath: ["guard:stripped"] }
          : { reply: null, handoff: true, usage: rewrite.usage, nodePath: ["guard:failed"] };
      }
    }

    if (s.input.kind === "palm_reading" && update.reply) {
      update = {
        ...update,
        reply: attachPaymentOffer(update.reply, s.input.config as PalmReadingConfig, {
          stage: s.sessionPatch.stage ?? s.input.session.stage,
          customerText: latestCustomerText(s.input.transcript),
        }),
      };
    }
    return update;
  };

  const handoff = (s: AgentGraphStateType): Update => ({
    reply: s.input.config.handoff_message || DEFAULT_HANDOFF_MESSAGE,
    handoff: true,
    sessionPatch: { stage: "handed_off" },
    nodePath: ["handoff"],
  });

  return new StateGraph(AgentGraphState)
    .addNode("gate", gate)
    .addNode("classify", classify)
    .addNode("specialist", specialist)
    .addNode("guard", guard)
    // Node names must not collide with state keys, hence "hand_off".
    .addNode("hand_off", handoff)
    .addEdge(START, "gate")
    .addConditionalEdges("gate", (s) => (s.skipReason ? "stop" : "classify"), {
      stop: END,
      classify: "classify",
    })
    .addConditionalEdges("classify", (s) => (s.handoff ? "hand_off" : "specialist"), {
      hand_off: "hand_off",
      specialist: "specialist",
    })
    .addConditionalEdges(
      "specialist",
      (s) => (s.handoff ? "hand_off" : s.reply ? "guard" : "stop"),
      { hand_off: "hand_off", guard: "guard", stop: END },
    )
    .addConditionalEdges("guard", (s) => (s.handoff ? "hand_off" : "done"), {
      hand_off: "hand_off",
      done: END,
    })
    .addEdge("hand_off", END)
    .compile();
}
