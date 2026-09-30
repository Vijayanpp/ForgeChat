import { escapeHtml } from "./render";

export interface ReportEmail {
  to: string;
  from: string;
  replyTo?: string;
  businessName: string;
  recipientName: string;
  reportUrl: string;
  html: string;
  /** Resend de-duplicates sends with the same key (retries never double-send). */
  idempotencyKey: string;
}

export interface EmailSender {
  sendReport(email: ReportEmail): Promise<{ id: string }>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function reportEmailBody(e: Pick<ReportEmail, "businessName" | "recipientName" | "reportUrl">): string {
  const brand = escapeHtml(e.businessName);
  const first = escapeHtml(e.recipientName.split(/\s+/)[0] || e.recipientName);
  const url = escapeHtml(e.reportUrl);
  return `<!DOCTYPE html><html><body style="margin:0;background:#ece8df;font-family:Georgia,serif;color:#1b1a18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdfa;border:1px solid #d9c9a6">
<tr><td style="background:#101a2f;padding:28px;text-align:center;color:#e8d9b3;font:700 13px Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase">${brand}</td></tr>
<tr><td style="padding:32px 32px 8px;font-size:17px;line-height:1.7">
<p>Dear ${first},</p>
<p>Your <b>Personalized Vedic Astrology &amp; Palm Analysis</b> report is ready. It has been prepared especially for you from your birth details and palm photograph.</p>
<p style="text-align:center;margin:30px 0"><a href="${url}" style="background:#b9923f;color:#fff;text-decoration:none;padding:14px 30px;font:700 14px Arial,sans-serif;letter-spacing:.08em;display:inline-block">OPEN YOUR REPORT</a></p>
<p style="font-size:15px;color:#6e665c">The full report is also attached to this email as an HTML file — open it in any browser, or use your browser's Print option to save it as a PDF.</p>
<p>With sincere guidance and blessings,<br><b>${brand}</b></p>
</td></tr>
<tr><td style="padding:18px 32px 28px;font:11px Arial,sans-serif;color:#8a8175">This private link is meant only for you. The reading is a traditional spiritual interpretation for personal reflection and entertainment.</td></tr>
</table></td></tr></table></body></html>`;
}

export function reportFileName(recipientName: string): string {
  const slug = recipientName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${slug || "Your"}-Palm-Report.html`;
}

export function createResendSender(apiKey: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    async sendReport(e) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": e.idempotencyKey,
        },
        body: JSON.stringify({
          from: e.from,
          to: [e.to],
          ...(e.replyTo ? { reply_to: e.replyTo } : {}),
          subject: `Your ${e.businessName} Personalized Palm & Vedic Astrology Report`,
          html: reportEmailBody(e),
          attachments: [
            { filename: reportFileName(e.recipientName), content: Buffer.from(e.html, "utf8").toString("base64") },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !body.id) {
        throw new EmailSendError(
          `email send failed (HTTP ${res.status}): ${body.message ?? "unknown error"}`,
          res.status === 429 || res.status >= 500,
        );
      }
      return { id: body.id };
    },
  };
}
