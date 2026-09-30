import { supabaseAdmin } from "@/lib/automations/admin-client";

import { agentRuntimeConfig } from "../config";
import { nextPendingDueInMs } from "./jobs";
import { drainAgentJobs } from "./worker";

/** Upper bound for the in-process timer; the cron drain covers anything later. */
const MAX_TIMER_MS = 60_000;

interface DispatcherState {
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
  draining: boolean;
  again: boolean;
}

// Kept on globalThis so dev-server module reloads don't orphan timers.
const KEY = Symbol.for("forgechat.agentDispatcher");
const g = globalThis as typeof globalThis & { [KEY]?: DispatcherState };
const state: DispatcherState = (g[KEY] ??= { timer: null, dueAt: 0, draining: false, again: false });

/**
 * In-process dispatch for long-lived Node hosts (Hostinger, VPS,
 * Docker). No-op when AI_AGENT_DISPATCH=cron, where the
 * /api/ai-agents/worker endpoint drains the queue instead.
 */
export function scheduleAgentDrain(delayMs: number): void {
  if (agentRuntimeConfig().dispatch !== "inline") return;
  const delay = Math.min(Math.max(delayMs, 0), MAX_TIMER_MS);
  const dueAt = Date.now() + delay;
  if (state.timer && state.dueAt <= dueAt) return;
  if (state.timer) clearTimeout(state.timer);
  state.dueAt = dueAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    void runDrain();
  }, delay);
  state.timer.unref?.();
}

async function runDrain(): Promise<void> {
  if (state.draining) {
    state.again = true;
    return;
  }
  state.draining = true;
  try {
    do {
      state.again = false;
      await drainAgentJobs({ timeBudgetMs: 45_000 });
    } while (state.again);

    const next = await nextPendingDueInMs(supabaseAdmin());
    if (next !== null) scheduleAgentDrain(next + 100);
  } catch (err) {
    console.error("[agents] in-process drain failed:", err);
  } finally {
    state.draining = false;
  }
}
