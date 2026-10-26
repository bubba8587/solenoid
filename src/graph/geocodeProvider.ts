// [[C23]] calcModes
// Open-Meteo geocoding (keyless, CORS-open). The node owns fetch and cache; the core reads the reply.
import { frameFnOnCore } from "./frameBackend";

export interface GeocodeMatch {
  /** "City, Region, Country" — stable across refreshes, so it is how a pick is stored. */
  label: string;
  lat: number;
  lon: number;
  /** IANA timezone (feeds Weather / Time Zone Convert); "" when the API omits it. */
  timezone: string;
}

export function geocodeUrl(place: string): string {
  const q = encodeURIComponent(place.trim());
  return `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=10&language=en&format=json`;
}

/** Best first, as the API ranks, read on the core (`providers.rs`); a malformed body or no results gives []. */
export function parseGeocode(text: string): GeocodeMatch[] {
  const r = frameFnOnCore("geocode", [], [text]);
  const rows = (r && !("frame" in r) ? r.value : []) as [string, number, number, string][];
  return rows.map(([label, lat, lon, timezone]) => ({ label, lat, lon, timezone }));
}

/** Matched by label, since an index would swap cities when the API reorders on a refresh; else the top match. */
export function pickGeocodeMatch(matches: readonly GeocodeMatch[], pickedLabel: string): GeocodeMatch | null {
  if (matches.length === 0) return null;
  if (pickedLabel) {
    const hit = matches.find((m) => m.label === pickedLabel);
    if (hit) return hit;
  }
  return matches[0];
}
