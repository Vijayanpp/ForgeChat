import type { SupabaseClient } from "@supabase/supabase-js";

import { computeVedicChart, type VedicChart } from "../astrology/chart";
import { parseAgentConfig } from "../kinds/catalog";
import { maskEmail } from "../kinds/palm-report-flow";
import type { LlmToolkit } from "../llm/toolkit";
import type { RuntimeAgent } from "../types";
import { EmailSendError, type EmailSender } from "./email";
import { generateReportContent } from "./generate";
import { renderReportHtml } from "./render";
import type { ReportSubject } from "./schema";
import { reportAccessToken, reportUrl } from "./token";

export interface ReportRow {
  id: string;
  account_id: string;
  agent_id: string | null;
  user_id: string;
  conversation_id: string;
  contact_id: string;
  subject: ReportSubject;
  palm_media: string[] | null;
  html: string | null;
  email_to: string;
  emailed_at: string | null;
  notified_at: string | null;
  attempts: number;
}

export interface ReportWorkerDeps {
  db: SupabaseClient;
  llm: LlmToolkit;
  email: EmailSender | null;
  defaultFrom: string;
  siteUrl: string;
  sendText(args: {
    accountId: string;
    userId: string;
    conversationId: string;
    contactId: string;
    text: string;
    aiAgentId: string | null;
  }): Promise<{ whatsapp_message_id: string }>;
  downloadImage(accountId: string, mediaUrl: string): Promise<string | null>;
  now: () => Date;
}

export const REPORT_MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

/** Config problems a retry cannot fix. */
export class ReportConfigError extends Error {}

function isRetryable(err: unknown): boolean {
  if (err instanceof ReportConfigError) return false;
  if (err instanceof EmailSendError) return err.retryable;
  return true;
}

async function update(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("ai_agent_reports").update(patch).eq("id", id);
  if (error) throw new Error(`failed to update report: ${error.message}`);
}

async function earlierReadings(db: SupabaseClient, conversationId: string): Promise<string> {
  const { data } = await db
    .from("messages")
    .select("content_text")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "bot")
    .order("created_at", { ascending: false })
    .limit(12);
  return (data ?? [])
    .map((m) => String(m.content_text ?? ""))
    .filter((t) => t.length > 200)
    .reverse()
    .join("\n---\n")
    .slice(0, 6000);
}

/** Generate → email → WhatsApp notify. Each finished step is recorded, so a retry resumes. */
export async function processReport(row: ReportRow, deps: ReportWorkerDeps): Promise<void> {
  const { db } = deps;
  try {
    const { data: agentRow } = await db
      .from("ai_agents")
      .select("*")
      .eq("id", row.agent_id ?? "")
      .eq("account_id", row.account_id)
      .maybeSingle();
    const agent = agentRow as RuntimeAgent | null;
    if (!agent) throw new ReportConfigError("agent no longer exists");
    const parsed = parseAgentConfig("palm_reading", agent.config);
    if (!parsed.ok) throw new ReportConfigError(`invalid agent config: ${parsed.error}`);
    const config = parsed.config;
    const businessName = config.business_name || agent.name;

    let html = row.html;
    if (!html) {
      const s = row.subject;
      const chart: VedicChart = computeVedicChart({
        date: s.dateOfBirth,
        time: s.birthTime,
        latitude: s.latitude,
        longitude: s.longitude,
        timezone: s.timezone,
      });
      const palmImages = (
        await Promise.all((row.palm_media ?? []).slice(-2).map((url) => deps.downloadImage(row.account_id, url)))
      ).filter((x): x is string => Boolean(x));

      const now = deps.now();
      const { content, usage } = await generateReportContent({
        llm: deps.llm,
        spec: { model: config.report_model || "gpt-4o", temperature: 0.7, maxTokens: 12_000, timeoutMs: 180_000 },
        businessName,
        personaPrompt: agent.system_prompt,
        subject: s,
        chart,
        palmImages,
        earlierReadings: await earlierReadings(db, row.conversation_id),
        now,
      });
      html = renderReportHtml({ businessName, subject: s, chart, content, palmImages, preparedOn: now });
      await update(db, row.id, {
        chart,
        content,
        html,
        generated_at: now.toISOString(),
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
      });
    }

    if (!deps.siteUrl) throw new ReportConfigError("NEXT_PUBLIC_SITE_URL is not set");
    const url = reportUrl(deps.siteUrl, reportAccessToken(row.id));

    if (!row.emailed_at) {
      const from = config.report_email_from || deps.defaultFrom;
      if (!deps.email || !from) throw new ReportConfigError("report email is not configured (RESEND_API_KEY / sender)");
      const { id } = await deps.email.sendReport({
        to: row.email_to,
        from,
        replyTo: config.report_reply_to || undefined,
        businessName,
        recipientName: row.subject.fullName,
        reportUrl: url,
        html,
        idempotencyKey: `report-${row.id}`,
      });
      await update(db, row.id, { email_message_id: id, emailed_at: deps.now().toISOString() });
    }

    if (!row.notified_at) {
      const first = row.subject.fullName.split(/\s+/)[0] || row.subject.fullName;
      const { whatsapp_message_id } = await deps.sendText({
        accountId: row.account_id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        aiAgentId: row.agent_id,
        text: `Your detailed report is ready, ${first}! 📜✨\n\nWe've emailed it to ${maskEmail(
          row.email_to,
        )} (please check Promotions/Spam if you don't see it).\n\nYou can also open it here:\n${url}`,
      });
      await update(db, row.id, { notified_message_id: whatsapp_message_id, notified_at: deps.now().toISOString() });
    }

    await update(db, row.id, { status: "completed", finished_at: deps.now().toISOString(), last_error: null });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.error("[agents/reports] report failed", row.id, message);
    if (isRetryable(err) && row.attempts < REPORT_MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      await update(db, row.id, {
        status: "pending",
        started_at: null,
        run_after: new Date(deps.now().getTime() + delay).toISOString(),
        last_error: message,
      }).catch(() => {});
      return;
    }
    await update(db, row.id, { status: "failed", finished_at: deps.now().toISOString(), last_error: message }).catch(() => {});
    await escalate(row, deps).catch((e) => console.error("[agents/reports] escalation failed", row.id, e));
  }
}

/** Tell the customer a person is on it and hand the conversation to the team. */
async function escalate(row: ReportRow, deps: ReportWorkerDeps): Promise<void> {
  await deps.db
    .from("ai_agent_sessions")
    .update({ handed_off: true })
    .eq("conversation_id", row.conversation_id)
    .eq("account_id", row.account_id);
  if (row.notified_at) return;
  await deps.sendText({
    accountId: row.account_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    aiAgentId: row.agent_id,
    text: "We're taking a little longer than expected to finish your detailed report 🙏 Our team has been notified and will send it to you personally very soon.",
  });
}

export async function drainReports(
  deps: ReportWorkerDeps,
  opts: { batchSize?: number; timeBudgetMs?: number } = {},
): Promise<{ processed: number }> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 50_000);
  let processed = 0;
  while (Date.now() < deadline) {
    const { data, error } = await deps.db.rpc("claim_ai_agent_reports", { p_limit: opts.batchSize ?? 2 });
    if (error) {
      console.error("[agents/reports] claim failed", error.message);
      break;
    }
    const rows = (data ?? []) as ReportRow[];
    if (rows.length === 0) break;
    await Promise.allSettled(rows.map((row) => processReport(row, deps)));
    processed += rows.length;
  }
  return { processed };
}
