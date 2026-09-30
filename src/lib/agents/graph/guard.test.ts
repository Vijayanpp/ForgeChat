import { describe, expect, it } from "vitest";

import { checkReply, MAX_REPLY_CHARS, normaliseReply, stripViolations } from "./guard";

describe("output guard", () => {
  it("converts markdown to WhatsApp formatting and strips prefixes", () => {
    expect(normaliseReply('Assistant: "## Hi\n**Great** news"')).toBe("Hi\n*Great* news");
  });

  it("truncates long replies at a sentence boundary", () => {
    const long = "This is a sentence. ".repeat(200);
    const out = normaliseReply(long);
    expect(out.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });

  it("flags AI disclosure, placeholders and empty replies", () => {
    expect(checkReply("As an AI language model, I can't.").violations).toHaveLength(1);
    expect(checkReply("Hi [Customer Name], welcome!").violations).toHaveLength(1);
    expect(checkReply("   ").violations).toEqual(["the reply was empty"]);
    expect(checkReply("Happy to help with your booking!").violations).toEqual([]);
  });

  it("strips only the offending sentences", () => {
    expect(stripViolations("Thanks for asking! As an AI I have no feelings. Your order ships Monday.")).toBe(
      "Thanks for asking! Your order ships Monday.",
    );
  });
});
