export interface GeoPlace {
  displayName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface Geocoder {
  resolve(place: string): Promise<GeoPlace | null>;
}

interface OpenMeteoResult {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  population?: number;
}

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Pick the candidate whose region/country best matches the extra parts
 * the customer typed ("Ganaur, Sonipat, Haryana"), then by population.
 */
export function bestPlaceMatch(results: OpenMeteoResult[], qualifiers: string[]): OpenMeteoResult | null {
  const quals = qualifiers.map(clean).filter(Boolean);
  let best: OpenMeteoResult | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (!r.timezone) continue;
    const region = [r.admin1, r.admin2, r.admin3, r.country].filter(Boolean).map((x) => clean(x!));
    const score =
      quals.filter((q) => region.some((reg) => reg.includes(q) || q.includes(reg))).length * 1e9 + (r.population ?? 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Open-Meteo geocoding: free, no key, returns the IANA time zone. */
export function createOpenMeteoGeocoder(fetchImpl: typeof fetch = fetch): Geocoder {
  return {
    async resolve(place) {
      const parts = place
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (!parts.length) return null;

      for (let i = 0; i < parts.length; i++) {
        const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
        url.searchParams.set("name", parts[i]);
        url.searchParams.set("count", "10");
        url.searchParams.set("language", "en");
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) throw new Error(`geocoding failed: HTTP ${res.status}`);
        const body = (await res.json()) as { results?: OpenMeteoResult[] };
        const match = bestPlaceMatch(body.results ?? [], [...parts.slice(0, i), ...parts.slice(i + 1)]);
        if (match?.timezone) {
          return {
            displayName: [match.name, match.admin2, match.admin1, match.country]
              .filter((x, idx, arr) => x && arr.indexOf(x) === idx)
              .join(", "),
            latitude: match.latitude,
            longitude: match.longitude,
            timezone: match.timezone,
          };
        }
      }
      return null;
    },
  };
}
