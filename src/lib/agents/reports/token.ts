import crypto from "crypto";

/**
 * The link token is derived from the report id, so retries rebuild
 * the same link without storing it. Only its sha256 is in the DB.
 */
export function reportAccessToken(reportId: string, secret = process.env.ENCRYPTION_KEY ?? ""): string {
  if (!secret) throw new Error("ENCRYPTION_KEY is required for report links");
  return crypto.createHmac("sha256", secret).update(`report:${reportId}`).digest("base64url");
}

export function hashReportToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function reportUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/r/${token}`;
}
