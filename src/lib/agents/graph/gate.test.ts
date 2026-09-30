import { describe, expect, it } from "vitest";

import { openFacts, testRuntime } from "../testing/fakes";
import { evaluateGate } from "./gate";

const now = new Date("2026-09-30T10:00:00Z");

describe("evaluateGate", () => {
  it("lets an open conversation with a fresh customer message through", () => {
    expect(evaluateGate(openFacts(), testRuntime, now)).toBeNull();
  });

  it.each([
    [{ conversationStatus: "closed" }, "conversation_closed"],
    [{ lastCustomerAt: null }, "no_customer_message"],
    [{ latestSender: "bot" as const }, "already_answered"],
    [{ latestSender: "agent" as const }, "already_answered"],
    [{ handedOff: true }, "handed_off"],
    [{ pausedUntil: "2026-09-30T11:00:00Z" }, "paused"],
    [{ lastHumanAt: "2026-09-30T09:45:00Z" }, "human_active"],
    [{ lastCustomerAt: "2026-09-29T09:00:00Z" }, "outside_24h_window"],
  ])("skips when %o", (overrides, reason) => {
    expect(evaluateGate(openFacts(overrides), testRuntime, now)).toBe(reason);
  });

  it("ignores an expired pause and an old human reply", () => {
    expect(
      evaluateGate(
        openFacts({ pausedUntil: "2026-09-30T09:00:00Z", lastHumanAt: "2026-09-30T08:00:00Z" }),
        testRuntime,
        now,
      ),
    ).toBeNull();
  });

  it("enforces the monthly token budget only when configured", () => {
    const facts = openFacts({ tokensUsedThisMonth: 5000 });
    expect(evaluateGate(facts, testRuntime, now)).toBeNull();
    expect(evaluateGate(facts, { ...testRuntime, monthlyTokenBudget: 5000 }, now)).toBe("budget_exceeded");
  });
});
