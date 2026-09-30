import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { z } from "zod";

import type { Usage } from "../types";

export interface ModelSpec {
  model: string;
  temperature: number;
  maxTokens: number;
  /** Defaults to 20s; long-form generation needs more. */
  timeoutMs?: number;
}

/**
 * The only surface specialists use to talk to a model. Keeps
 * LangChain types out of specialist logic and gives tests a seam.
 */
export interface LlmToolkit {
  chat(
    spec: ModelSpec,
    messages: BaseMessage[],
    config?: RunnableConfig,
  ): Promise<{ text: string; usage: Usage }>;
  structured<T extends Record<string, unknown>>(
    spec: ModelSpec,
    schema: z.ZodType<T>,
    name: string,
    messages: BaseMessage[],
    config?: RunnableConfig,
  ): Promise<{ data: T; usage: Usage }>;
}

interface UsageMetadataLike {
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
}

export function usageFrom(message: unknown): Usage {
  const meta = (message as UsageMetadataLike | null)?.usage_metadata;
  return {
    promptTokens: meta?.input_tokens ?? 0,
    completionTokens: meta?.output_tokens ?? 0,
  };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

export function createOpenAiToolkit(): LlmToolkit {
  const cache = new Map<string, ChatOpenAI>();

  const modelFor = (spec: ModelSpec): ChatOpenAI => {
    const timeout = spec.timeoutMs ?? 20_000;
    const key = `${spec.model}|${spec.temperature}|${spec.maxTokens}|${timeout}`;
    let model = cache.get(key);
    if (!model) {
      model = new ChatOpenAI({
        model: spec.model,
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        apiKey: process.env.OPENAI_API_KEY,
        timeout,
        maxRetries: 1,
      });
      cache.set(key, model);
    }
    return model;
  };

  return {
    async chat(spec, messages, config) {
      const result = await modelFor(spec).invoke(messages, config);
      return { text: contentToText(result.content).trim(), usage: usageFrom(result) };
    },

    async structured(spec, schema, name, messages, config) {
      const runnable = modelFor(spec).withStructuredOutput(schema, {
        name,
        includeRaw: true,
      });
      const result = (await runnable.invoke(messages, config)) as {
        raw: unknown;
        parsed: unknown;
      };
      const parsed = schema.safeParse(result.parsed);
      if (!parsed.success) {
        throw new Error(`structured output "${name}" failed validation`);
      }
      return { data: parsed.data, usage: usageFrom(result.raw) };
    },
  };
}
