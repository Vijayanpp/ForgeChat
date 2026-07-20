/** Default link text when admin leaves label empty. */
export const DEFAULT_AFFILIATE_LABEL = "Learn more";

export const MAX_AFFILIATE_LABEL_LEN = 80;
export const MAX_AFFILIATE_URL_LEN = 2048;

/** Returns a trimmed label or the default. */
export function resolveAffiliateLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_AFFILIATE_LABEL;
}

/** Validates an affiliate URL for save. Returns an error message or null. */
export function validateAffiliateUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return "URL is required when the affiliate link is enabled";
  }
  if (trimmed.length > MAX_AFFILIATE_URL_LEN) {
    return `URL must be ${MAX_AFFILIATE_URL_LEN} characters or fewer`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return "URL must start with https://";
    }
  } catch {
    return "Enter a valid URL";
  }
  return null;
}

/** Whether the link should render in the Inbox composer. */
export function isAffiliateLinkVisible(
  enabled: boolean,
  url: string | null | undefined,
): boolean {
  return enabled && !!url?.trim();
}
