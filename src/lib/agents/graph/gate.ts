import type { AgentRuntimeConfig } from "../config";
import type { GateFacts, SkipReason } from "../types";

/** Meta only allows free-form replies within 24h of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether the AI may speak at all this turn. Pure: all facts
 * are gathered by the caller. Order matters — the most specific
 * human-control reasons win.
 */
export function evaluateGate(
  facts: GateFacts,
  runtime: Pick<AgentRuntimeConfig, "humanCooldownMinutes" | "monthlyTokenBudget">,
  now: Date = new Date(),
): SkipReason | null {
  if (facts.conversationStatus === "closed") return "conversation_closed";
  if (!facts.lastCustomerAt) return "no_customer_message";
  if (facts.latestSender && facts.latestSender !== "customer") return "already_answered";
  if (facts.handedOff) return "handed_off";
  if (facts.pausedUntil && new Date(facts.pausedUntil).getTime() > now.getTime()) return "paused";

  if (facts.lastHumanAt && runtime.humanCooldownMinutes > 0) {
    const sinceHuman = now.getTime() - new Date(facts.lastHumanAt).getTime();
    if (sinceHuman < runtime.humanCooldownMinutes * 60_000) return "human_active";
  }

  if (now.getTime() - new Date(facts.lastCustomerAt).getTime() > SERVICE_WINDOW_MS) {
    return "outside_24h_window";
  }

  if (runtime.monthlyTokenBudget > 0 && facts.tokensUsedThisMonth >= runtime.monthlyTokenBudget) {
    return "budget_exceeded";
  }
  return null;
}
