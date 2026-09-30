import { describe, expect, it } from "vitest";

import { redactText, redactValue } from "./redact";

describe("trace redaction", () => {
  it("removes phones, emails and inline images", () => {
    expect(redactText("Call +91 98765 43210 or mail a.b@c.io")).toBe("Call [phone] or mail [email]");
    expect(redactText("img data:image/jpeg;base64,/9j/4AAQSk== end")).toBe("img [image] end");
  });

  it("keeps prices, dates and ticket counts", () => {
    expect(redactText("2 tickets on 2026-10-05 for ₹1,499")).toBe("2 tickets on 2026-10-05 for ₹1,499");
  });

  it("walks nested structures", () => {
    expect(
      redactValue({ messages: [{ content: [{ type: "text", text: "my number 9876543210" }] }] }),
    ).toEqual({ messages: [{ content: [{ type: "text", text: "my number [phone]" }] }] });
  });
});
