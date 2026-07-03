// ============================================================
// Legal entity configuration — single source of truth for the
// Privacy Policy and Terms & Conditions pages.
//
// PLACEHOLDER VALUES: replace every field below with your actual
// registered business details before going live. Nothing here is
// read by application logic — it only feeds the legal page copy —
// but shipping with placeholders is a compliance risk.
// ============================================================

export const LEGAL_CONFIG = {
  /** Trading name shown throughout the product. */
  productName: "ForgeChat",
  /** Registered legal entity name (company / proprietorship / LLP). */
  entityName: "AgentForge",
  /** Full registered address, single line or comma-separated. */
  registeredAddress: "India",
  /** General support contact. */
  supportEmail: "support@forgechat.co.in",
  /** Privacy-specific contact (can be the same as support). */
  privacyEmail: "support@forgechat.co.in",
  /**
   * India's IT Rules 2021 / DPDP Act require a named grievance
   * officer for any privacy policy covering Indian users. No
   * individual appointed yet, so this is a role-based stand-in —
   * swap in an actual person's name once you designate one.
   */
  grievanceOfficerName: "Grievance Officer",
  grievanceOfficerEmail: "support@forgechat.co.in",
  /** City/state whose courts have exclusive jurisdiction over disputes. */
  jurisdiction: "Bengaluru, Karnataka, India",
  /** ISO date the current policy/terms text took effect (YYYY-MM-DD). */
  effectiveDate: "2026-07-02",
} as const;
