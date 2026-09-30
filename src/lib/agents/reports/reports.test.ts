import type { BaseMessage } from "@langchain/core/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeVedicChart } from "../astrology/chart";
import { fakeLlm, lastHumanText, testAgent } from "../testing/fakes";
import type { EmailSender, ReportEmail } from "./email";
import { generateReportContent } from "./generate";
import { CHAPTERS } from "./outline";
import { escapeHtml, renderReportHtml } from "./render";
import type { ReportBrief, ReportSubject } from "./schema";
import { hashReportToken, reportAccessToken } from "./token";
import { processReport, type ReportRow, type ReportWorkerDeps } from "./worker";

const NOW = new Date("2026-09-30T10:00:00Z");

const subject: ReportSubject = {
  fullName: "Lavish <b>Malik</b>",
  dateOfBirth: "2010-12-17",
  birthTime: "13:56",
  birthPlace: "Ganaur, Sonipat, Haryana",
  resolvedPlace: "Ganaur, Haryana, India",
  latitude: 29.1302,
  longitude: 77.01832,
  timezone: "Asia/Kolkata",
  email: "lavish@gmail.com",
};

const brief: ReportBrief = {
  core_themes: ["courage"],
  strengths: ["focus"],
  challenges: ["patience"],
  life_windows: ["Age 16–18: study"],
  palm_observations: ["clear head line"],
  personal_message: ["Dear Lavish, this is for you."],
  first_insight: { title: "First insight", text: "You lead." },
  toc_quote: "Know yourself.",
  how_to_use: "Read slowly.",
  closing_insight: { title: "Closing", text: "Keep going." },
  guardian_note: "Parents: encourage gently.",
};

const block = (kind: "lead" | "paragraph", text: string) => ({ kind, title: "", text, items: [], cards: [] });

function reportLlm() {
  return fakeLlm({
    report_brief: () => brief,
    report_chapters: (messages: BaseMessage[]) => {
      const ids = [...lastHumanText(messages).matchAll(/- id "(\w+)"/g)].map((m) => m[1]);
      return {
        chapters: ids.map((id) => ({
          id,
          blocks: [block("lead", `Lead for ${id}`), block("paragraph", "Body <script>x</script>"), block("paragraph", "More.")],
        })),
      };
    },
  });
}

describe("report generation and rendering", () => {
  it("writes every chapter in outline order", async () => {
    const llm = reportLlm();
    const chart = computeVedicChart({ date: subject.dateOfBirth, time: subject.birthTime, latitude: subject.latitude, longitude: subject.longitude, timezone: subject.timezone });
    const { content, steps } = await generateReportContent({
      llm,
      spec: { model: "report-model", temperature: 0.7, maxTokens: 12_000 },
      businessName: "AskMyPalm",
      personaPrompt: "",
      subject,
      chart,
      palmImages: [],
      earlierReadings: "",
      now: NOW,
    });
    expect(content.chapters.map((c) => c.id)).toEqual(CHAPTERS.map((c) => c.id));
    expect(steps[0]).toBe("report:brief");
    expect(llm.calls.filter((c) => c.name === "report_chapters").length).toBe(7);

    const html = renderReportHtml({ businessName: "AskMyPalm", subject, chart, content, palmImages: ["javascript:alert(1)"], preparedOn: NOW });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).toContain(escapeHtml("Lavish <b>Malik</b>"));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("A Note for Parents");
    expect(html).toContain("Aries");
  });
});

describe("report tokens", () => {
  it("derives a stable token and stores only its hash", () => {
    const t = reportAccessToken("rep-1", "secret");
    expect(t).toBe(reportAccessToken("rep-1", "secret"));
    expect(t).not.toBe(reportAccessToken("rep-2", "secret"));
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashReportToken(t)).toHaveLength(64);
  });
});

function fakeDb(agentConfig: Record<string, unknown>) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const agent = testAgent({ agent_type: "palm_reading", config: agentConfig });
  const from = (table: string) => {
    let op = "select";
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "not", "in"]) chain[m] = () => chain;
    chain.update = (patch: Record<string, unknown>) => {
      op = "update";
      updates.push({ table, patch });
      return chain;
    };
    chain.maybeSingle = async () => ({ data: table === "ai_agents" ? agent : null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(op === "update" ? { error: null } : { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

describe("processReport", () => {
  beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "k".repeat(64)));
  afterEach(() => vi.unstubAllEnvs());

  const row = (overrides: Partial<ReportRow> = {}): ReportRow => ({
    id: "rep-1",
    account_id: "acct-1",
    agent_id: "agent-1",
    user_id: "user-1",
    conversation_id: "conv-1",
    contact_id: "contact-1",
    subject,
    palm_media: [],
    html: null,
    email_to: subject.email,
    emailed_at: null,
    notified_at: null,
    attempts: 1,
    ...overrides,
  });

  function deps(agentConfig: Record<string, unknown>, email: EmailSender | null) {
    const { db, updates } = fakeDb({ business_name: "AskMyPalm", paid_report_enabled: true, ...agentConfig });
    const texts: string[] = [];
    const llm = reportLlm();
    const d: ReportWorkerDeps = {
      db,
      llm,
      email,
      defaultFrom: "AskMyPalm <reports@askmypalm.com>",
      siteUrl: "https://app.example.com/",
      sendText: async ({ text }) => {
        texts.push(text);
        return { whatsapp_message_id: `wamid-${texts.length}` };
      },
      downloadImage: async () => null,
      now: () => NOW,
    };
    return { d, updates, texts, llm };
  }

  const recordingEmail = () => {
    const sent: ReportEmail[] = [];
    const sender: EmailSender = {
      async sendReport(e) {
        sent.push(e);
        return { id: "email-1" };
      },
    };
    return { sender, sent };
  };

  it("generates, emails with an idempotency key, then notifies on WhatsApp", async () => {
    const email = recordingEmail();
    const { d, updates, texts } = deps({}, email.sender);
    await processReport(row(), d);

    const link = `https://app.example.com/r/${reportAccessToken("rep-1")}`;
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: "lavish@gmail.com", idempotencyKey: "report-rep-1", reportUrl: link });
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(link);
    expect(texts[0]).toContain("la****@gmail.com");
    const patches = updates.filter((u) => u.table === "ai_agent_reports").map((u) => Object.keys(u.patch));
    expect(patches[0]).toEqual(expect.arrayContaining(["html", "generated_at", "chart"]));
    expect(patches.at(-1)).toEqual(expect.arrayContaining(["status", "finished_at"]));
  });

  it("resumes without repeating finished steps", async () => {
    const email = recordingEmail();
    const { d, texts, llm } = deps({}, email.sender);
    await processReport(row({ html: "<html></html>", emailed_at: NOW.toISOString() }), d);
    expect(llm.calls).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
    expect(texts).toHaveLength(1);
  });

  it("fails fast without email config and hands the conversation to a human", async () => {
    const { d, updates, texts } = deps({}, null);
    await processReport(row({ html: "<html></html>" }), d);
    const reportUpdate = updates.find((u) => u.table === "ai_agent_reports")!;
    expect(reportUpdate.patch).toMatchObject({ status: "failed" });
    expect(updates.some((u) => u.table === "ai_agent_sessions" && u.patch.handed_off === true)).toBe(true);
    expect(texts[0]).toContain("Our team has been notified");
  });

  it("retries transient failures with backoff", async () => {
    const failing: EmailSender = {
      async sendReport() {
        throw new Error("network down");
      },
    };
    const { d, updates, texts } = deps({}, failing);
    await processReport(row({ html: "<html></html>", attempts: 1 }), d);
    expect(updates.at(-1)!.patch).toMatchObject({ status: "pending", last_error: "network down" });
    expect(texts).toHaveLength(0);
  });
});
