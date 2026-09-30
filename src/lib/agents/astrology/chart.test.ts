import { describe, expect, it } from "vitest";

import { computeVedicChart, lahiriAyanamsa, localToUtc } from "./chart";
import { bestPlaceMatch } from "./geocode";

describe("Vedic chart", () => {
  it("matches the AskMyPalm sample report (Lavish Malik)", () => {
    // 17 Dec 2010, 1:56 PM, Ganaur (Sonipat, Haryana)
    const chart = computeVedicChart({
      date: "2010-12-17",
      time: "13:56",
      latitude: 29.1333,
      longitude: 77.0167,
      timezone: "Asia/Kolkata",
    });
    expect(chart.utc).toBe("2010-12-17T08:26:00.000Z");
    expect(chart.ascendant?.sign).toBe("Aries");
    expect(chart.moon.sign).toBe("Aries");
    expect(chart.nakshatra).toMatchObject({ name: "Ashwini", pada: 4, lord: "Ketu" });
  });

  it("uses historical time-zone offsets", () => {
    // New York was on EDT (UTC-4) in July.
    expect(localToUtc("2000-07-01", "12:00", "America/New_York").toISOString()).toBe("2000-07-01T16:00:00.000Z");
    expect(localToUtc("2000-01-01", "12:00", "America/New_York").toISOString()).toBe("2000-01-01T17:00:00.000Z");
  });

  it("has a Lahiri ayanamsa of about 23°51' at J2000", () => {
    expect(lahiriAyanamsa(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(23.853, 2);
    expect(lahiriAyanamsa(new Date("2026-01-01T00:00:00Z"))).toBeCloseTo(24.216, 1);
  });

  it("omits the ascendant when the birth time is unknown", () => {
    const chart = computeVedicChart({
      date: "1990-05-10",
      time: null,
      latitude: 19.07,
      longitude: 72.88,
      timezone: "Asia/Kolkata",
    });
    expect(chart.ascendant).toBeNull();
    expect(chart.timeKnown).toBe(false);
    expect(chart.moon.sign).toBeTruthy();
  });
});

describe("place matching", () => {
  it("prefers the candidate in the region the customer named", () => {
    const results = [
      { name: "Ganaur", latitude: 1, longitude: 1, timezone: "Asia/Kolkata", admin1: "Uttar Pradesh", country: "India", population: 90000 },
      { name: "Ganaur", latitude: 29.13, longitude: 77.02, timezone: "Asia/Kolkata", admin1: "Haryana", admin2: "Sonipat", country: "India", population: 35000 },
    ];
    expect(bestPlaceMatch(results, ["Sonipat", "Haryana"])?.admin1).toBe("Haryana");
    expect(bestPlaceMatch(results, [])?.admin1).toBe("Uttar Pradesh");
  });
});
