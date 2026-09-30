import type { GeoPlace } from "../astrology/geocode";
import type { PaymentStatus } from "../payments/decide";
import type { ReportSubject } from "../reports/schema";
import { asRecord } from "./shared";

/**
 * offered    — link sent, waiting for a payment screenshot
 * collecting — payment verified or under review; gathering birth details
 * confirming — all details valid, summary shown, waiting for "yes"
 * waiting_payment — details confirmed, payment still under human review
 * queued     — report requested (generation/email runs in the background)
 */
export type ReportStage = "none" | "offered" | "collecting" | "confirming" | "waiting_payment" | "queued";

export interface BirthDetails {
  full_name?: string;
  date_of_birth?: string;
  /** HH:MM or "unknown". */
  birth_time?: string;
  birth_place?: string;
  email?: string;
}

export interface ReportSlots {
  stage: ReportStage;
  offeredAt: string | null;
  paymentId: string | null;
  paymentStatus: PaymentStatus | null;
  rejections: number;
  details: BirthDetails;
  place: GeoPlace | null;
  reportId: string | null;
}

export function readReportSlots(slots: Record<string, unknown>): ReportSlots {
  const r = asRecord(slots.report);
  const details = asRecord(r.details);
  const place = asRecord(r.place);
  return {
    stage: (typeof r.stage === "string" ? r.stage : "none") as ReportStage,
    offeredAt: typeof r.offeredAt === "string" ? r.offeredAt : null,
    paymentId: typeof r.paymentId === "string" ? r.paymentId : null,
    paymentStatus: (typeof r.paymentStatus === "string" ? r.paymentStatus : null) as PaymentStatus | null,
    rejections: Number(r.rejections ?? 0) || 0,
    details: Object.fromEntries(
      Object.entries(details).filter(([, v]) => typeof v === "string" && v.trim()),
    ) as BirthDetails,
    place:
      typeof place.timezone === "string" && typeof place.latitude === "number" && typeof place.longitude === "number"
        ? (place as unknown as GeoPlace)
        : null,
    reportId: typeof r.reportId === "string" ? r.reportId : null,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const DETAIL_LABELS: Record<keyof BirthDetails, string> = {
  full_name: "full name",
  date_of_birth: "date of birth",
  birth_time: "birth time (or say you don't know it)",
  birth_place: "birth place (town/city, state)",
  email: "email address for the report",
};

export function normaliseDetail(key: keyof BirthDetails, value: string, today: Date): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (key) {
    case "full_name":
      return v.length >= 2 && v.length <= 80 ? v.replace(/\s+/g, " ") : null;
    case "date_of_birth": {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      const valid = d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
      return valid && +m[1] >= 1900 && d.getTime() <= today.getTime() ? v : null;
    }
    case "birth_time": {
      if (/^unknown$/i.test(v)) return "unknown";
      const m = v.match(/^(\d{1,2}):(\d{2})$/);
      return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
    }
    case "birth_place":
      return v.length >= 2 && v.length <= 120 ? v : null;
    case "email":
      return EMAIL.test(v) && v.length <= 200 ? v.toLowerCase() : null;
  }
}

export function missingDetails(details: BirthDetails): (keyof BirthDetails)[] {
  return (Object.keys(DETAIL_LABELS) as (keyof BirthDetails)[]).filter((k) => !details[k]);
}

export type DetailsAction = "ask_missing" | "confirm" | "request_report" | "wait_payment";

/** Book only on an explicit "yes" to an unchanged, complete summary. */
export function decideDetailsAction(args: {
  stage: ReportStage;
  complete: boolean;
  changed: boolean;
  confirmation: "yes" | "no" | "none";
  paymentVerified: boolean;
}): DetailsAction {
  if (!args.complete) return "ask_missing";
  if (args.stage !== "confirming" || args.changed || args.confirmation !== "yes") return "confirm";
  return args.paymentVerified ? "request_report" : "wait_payment";
}

function formatDob(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function detailsSummary(details: BirthDetails, place: GeoPlace | null): string {
  const time =
    details.birth_time === "unknown"
      ? "Not known"
      : details.birth_time
        ? (() => {
            const [h, m] = details.birth_time!.split(":").map(Number);
            return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
          })()
        : "";
  return [
    `*Name:* ${details.full_name}`,
    `*Date of birth:* ${details.date_of_birth ? formatDob(details.date_of_birth) : ""}`,
    `*Birth time:* ${time}`,
    `*Birth place:* ${place?.displayName ?? details.birth_place}`,
    `*Email:* ${details.email}`,
  ].join("\n");
}

export function reportSubject(details: BirthDetails, place: GeoPlace | null): ReportSubject | null {
  if (missingDetails(details).length || !place) return null;
  return {
    fullName: details.full_name!,
    dateOfBirth: details.date_of_birth!,
    birthTime: details.birth_time === "unknown" ? null : details.birth_time!,
    birthPlace: details.birth_place!,
    resolvedPlace: place.displayName,
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
    email: details.email!,
  };
}

export function palmMediaFromSlots(slots: Record<string, unknown>): string[] {
  return Array.isArray(slots.palm_media)
    ? (slots.palm_media as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, Math.min(2, user.length))}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}
