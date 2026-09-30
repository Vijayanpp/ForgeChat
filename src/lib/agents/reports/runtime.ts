import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendText } from "@/lib/automations/meta-send";
import { downloadWhatsAppImageDataUrl } from "@/lib/ai/resolve-message-media";

import { agentRuntimeConfig } from "../config";
import { createOpenAiToolkit } from "../llm/toolkit";
import { createResendSender } from "./email";
import { drainReports, type ReportWorkerDeps } from "./worker";

let deps: ReportWorkerDeps | null = null;

export function reportWorkerDeps(): ReportWorkerDeps {
  if (!deps) {
    const apiKey = process.env.RESEND_API_KEY;
    return (deps = {
      db: supabaseAdmin(),
      llm: createOpenAiToolkit(),
      email: apiKey ? createResendSender(apiKey) : null,
      defaultFrom: process.env.REPORT_EMAIL_FROM ?? "",
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
      sendText: ({ aiAgentId, ...args }) => engineSendText({ ...args, aiAgentId: aiAgentId ?? undefined }),
      downloadImage: downloadWhatsAppImageDataUrl,
      now: () => new Date(),
    });
  }
  return deps;
}

const KEY = Symbol.for("forgechat.reportDispatcher");
const g = globalThis as typeof globalThis & { [KEY]?: { running: boolean; again: boolean } };
const state = (g[KEY] ??= { running: false, again: false });

/**
 * Start report generation in-process right after a report is queued
 * (long-lived Node hosts). With AI_AGENT_DISPATCH=cron the
 * /api/ai-agents/reports/worker endpoint picks it up instead.
 */
export function scheduleReportDrain(): void {
  if (agentRuntimeConfig().dispatch !== "inline") return;
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  setTimeout(async () => {
    try {
      do {
        state.again = false;
        await drainReports(reportWorkerDeps(), { timeBudgetMs: 280_000 });
      } while (state.again);
    } catch (err) {
      console.error("[agents/reports] in-process drain failed:", err);
    } finally {
      state.running = false;
    }
  }, 250).unref?.();
}
