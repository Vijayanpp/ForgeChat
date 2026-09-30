import { describe, expect, it } from "vitest";

import {
  decideDetailsAction,
  detailsSummary,
  maskEmail,
  missingDetails,
  normaliseDetail,
  readReportSlots,
  reportSubject,
} from "./palm-report-flow";

const today = new Date("2026-09-30T10:00:00Z");

describe("normaliseDetail", () => {
  it("accepts real dates only, not in the future", () => {
    expect(normaliseDetail("date_of_birth", "2010-12-17", today)).toBe("2010-12-17");
    expect(normaliseDetail("date_of_birth", "2010-02-30", today)).toBeNull();
    expect(normaliseDetail("date_of_birth", "2030-01-01", today)).toBeNull();
    expect(normaliseDetail("date_of_birth", "17/12/2010", today)).toBeNull();
  });

  it("normalises birth time and accepts unknown", () => {
    expect(normaliseDetail("birth_time", "9:05", today)).toBe("09:05");
    expect(normaliseDetail("birth_time", "Unknown", today)).toBe("unknown");
    expect(normaliseDetail("birth_time", "25:00", today)).toBeNull();
  });

  it("validates and lowercases email", () => {
    expect(normaliseDetail("email", "Lavish.M@Gmail.com", today)).toBe("lavish.m@gmail.com");
    expect(normaliseDetail("email", "lavish@gmail", today)).toBeNull();
  });
});

describe("decideDetailsAction", () => {
  const base = { stage: "confirming" as const, complete: true, changed: false, confirmation: "yes" as const, paymentVerified: true };

  it("books only on yes to an unchanged, complete summary", () => {
    expect(decideDetailsAction(base)).toBe("request_report");
    expect(decideDetailsAction({ ...base, changed: true })).toBe("confirm");
    expect(decideDetailsAction({ ...base, stage: "collecting" })).toBe("confirm");
    expect(decideDetailsAction({ ...base, confirmation: "none" })).toBe("confirm");
    expect(decideDetailsAction({ ...base, complete: false })).toBe("ask_missing");
  });

  it("waits for human verification before booking", () => {
    expect(decideDetailsAction({ ...base, paymentVerified: false })).toBe("wait_payment");
  });
});

describe("report slots", () => {
  const place = { displayName: "Ganaur, Haryana, India", latitude: 29.13, longitude: 77.02, timezone: "Asia/Kolkata" };
  const details = {
    full_name: "Lavish Malik",
    date_of_birth: "2010-12-17",
    birth_time: "13:56",
    birth_place: "Ganaur, Sonipat",
    email: "lavish@gmail.com",
  };

  it("summarises details for confirmation", () => {
    const text = detailsSummary(details, place);
    expect(text).toContain("*Name:* Lavish Malik");
    expect(text).toContain("17 December 2010");
    expect(text).toContain("1:56 PM");
    expect(text).toContain("Ganaur, Haryana, India");
  });

  it("builds a subject only when complete and geocoded", () => {
    expect(reportSubject(details, place)).toMatchObject({ birthTime: "13:56", timezone: "Asia/Kolkata" });
    expect(reportSubject({ ...details, birth_time: "unknown" }, place)?.birthTime).toBeNull();
    expect(reportSubject(details, null)).toBeNull();
    expect(missingDetails({ full_name: "A B" })).toEqual(["date_of_birth", "birth_time", "birth_place", "email"]);
  });

  it("reads defensively from stored slots", () => {
    expect(readReportSlots({}).stage).toBe("none");
    expect(readReportSlots({ report: { stage: "queued", rejections: "x", place: { latitude: "bad" } } })).toMatchObject({
      stage: "queued",
      rejections: 0,
      place: null,
    });
  });

  it("masks email for chat messages", () => {
    expect(maskEmail("lavish@gmail.com")).toBe("la****@gmail.com");
  });
});
