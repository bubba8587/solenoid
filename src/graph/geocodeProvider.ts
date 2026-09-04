// Open-Meteo geocoding (keyless, CORS-open): a place name → coordinate matches. The
// PARSE is pure + fixture-tested (widget rule 5); the node does the fetch/cache.

export interface GeocodeMatch {
  /** "City, Region, Country" — stable across refreshes, so it is how a pick is stored. */
  label: string;
  lat: number;
  lon: number;
  /** IANA timezone (feeds Weather / Time Zone Convert); "" when the API omits it. */
  timezone: string;
}

/** The search endpoint for a place name (English labels, up to 10 matches). */
export function geocodeUrl(place: string): string {
  const q = encodeURIComponent(place.trim());
  return `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=10&language=en&format=json`;
}

/** Parse the geocoding response into matches, best first (the API already ranks). A
 *  malformed body or no results → []. */
export function parseGeocode(text: string): GeocodeMatch[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: GeocodeMatch[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    if (typeof o.latitude !== "number" || typeof o.longitude !== "number") continue;
    const name = typeof o.name === "string" ? o.name : "";
    const admin1 = typeof o.admin1 === "string" ? o.admin1 : "";
    const country = typeof o.country === "string" ? o.country : "";
    const label = [name, admin1, country].filter(Boolean).join(", ") || name || "(unknown place)";
    out.push({ label, lat: o.latitude, lon: o.longitude, timezone: typeof o.timezone === "string" ? o.timezone : "" });
  }
  return out;
}

/** The match a stored pick NAMES (by label — positional index would swap cities when
 *  the API reorders on a refresh), else the top match. */
export function pickGeocodeMatch(matches: readonly GeocodeMatch[], pickedLabel: string): GeocodeMatch | null {
  if (matches.length === 0) return null;
  if (pickedLabel) {
    const hit = matches.find((m) => m.label === pickedLabel);
    if (hit) return hit;
  }
  return matches[0];
}
