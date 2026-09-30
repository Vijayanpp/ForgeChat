import { e_tilt, EclipticGeoMoon, MakeTime, SiderealTime } from "astronomy-engine";

export const RASHIS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
] as const;

export const NAKSHATRAS = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Mula",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
] as const;

const NAKSHATRA_SPAN = 360 / 27;
const PADA_SPAN = NAKSHATRA_SPAN / 4;
const RAD = Math.PI / 180;

export interface BirthMoment {
  /** YYYY-MM-DD, local civil date at the birth place. */
  date: string;
  /** HH:MM (24h) local civil time, or null when unknown. */
  time: string | null;
  latitude: number;
  longitude: number;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string;
}

export interface VedicChart {
  utc: string;
  ayanamsa: number;
  /** Null when the birth time is unknown: the ascendant changes every ~2 hours. */
  ascendant: { sign: string; degree: number } | null;
  moon: { sign: string; degree: number; longitude: number };
  nakshatra: { name: string; pada: number; lord: string };
  timeKnown: boolean;
}

const NAKSHATRA_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"];

export const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Offset (minutes) of `zone` from UTC at the given instant, using the runtime's tz database. */
function zoneOffsetMinutes(zone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Local wall-clock time in `zone` → UTC instant (historical offsets included). */
export function localToUtc(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = new Date(wall);
  for (let i = 0; i < 2; i++) guess = new Date(wall - zoneOffsetMinutes(zone, guess) * 60_000);
  return guess;
}

/** Lahiri (Chitrapaksha) ayanamsa: J2000 value advanced by IAU general precession. */
export function lahiriAyanamsa(utc: Date): number {
  const t = (MakeTime(utc).tt) / 36525;
  return 23.85319 + (5028.796195 * t + 1.1054348 * t * t) / 3600;
}

/** Tropical ascendant from local sidereal time, latitude and true obliquity. */
export function tropicalAscendant(utc: Date, latitude: number, longitude: number): number {
  const ramc = norm360(SiderealTime(utc) * 15 + longitude) * RAD;
  const eps = e_tilt(MakeTime(utc)).tobl * RAD;
  const phi = latitude * RAD;
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)));
  return norm360(asc / RAD);
}

const signOf = (lon: number) => ({ sign: RASHIS[Math.floor(lon / 30)], degree: Math.round((lon % 30) * 100) / 100 });

export function computeVedicChart(birth: BirthMoment): VedicChart {
  const timeKnown = Boolean(birth.time);
  const utc = localToUtc(birth.date, birth.time ?? "12:00", birth.timezone);
  const ayanamsa = lahiriAyanamsa(utc);

  const moonLon = norm360(EclipticGeoMoon(utc).lon - ayanamsa);
  const nIndex = Math.floor(moonLon / NAKSHATRA_SPAN);
  const pada = Math.floor((moonLon % NAKSHATRA_SPAN) / PADA_SPAN) + 1;

  return {
    utc: utc.toISOString(),
    ayanamsa: Math.round(ayanamsa * 10_000) / 10_000,
    ascendant: timeKnown
      ? signOf(norm360(tropicalAscendant(utc, birth.latitude, birth.longitude) - ayanamsa))
      : null,
    moon: { ...signOf(moonLon), longitude: Math.round(moonLon * 100) / 100 },
    nakshatra: { name: NAKSHATRAS[nIndex], pada, lord: NAKSHATRA_LORDS[nIndex % 9] },
    timeKnown,
  };
}
